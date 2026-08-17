"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Kanban, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { OrganizationEventRow } from "@/features/organizations";
import {
  CRM_PIPELINE_STAGES,
  crmPipelineIdSchema,
  crmPipelineEntryDtoSchema,
  directoryPageDtoSchema,
  eventIdSchema,
  organizationContactHistoryDtoSchema,
  type CreateCrmPipelineEntryInput,
  type CrmPipelineEntryDTO,
  type CrmPipelineId,
  type CrmPipelineStage,
  type OrganizationContactDTO,
  type OrganizationContactId,
  type OrganizationContactSummaryDTO,
  type OrganizationId,
} from "@/shared/contracts";
import { Button, EmptyState, Field, Modal, PageHeader, Select } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { AppError, isAppError, isDefinitiveWriteFailure } from "@/shared/lib/errors";
import { createStableCreateRequestId } from "@/shared/lib/stable-create-request-id";
import { CrmNav } from "./crm-nav";
import { STAGE_LABEL } from "./pipeline-labels";

const CREATE_RECOVERY_MESSAGE = "We could not confirm whether this prospect was added. Its details are locked so Retry addition can safely recover the same attempt. You can also close and check the pipeline.";
const CONTACT_REFRESH_RECOVERY_MESSAGE = "The prospect was added, but we could not load its current contact after a merge. Retry the contact refresh, or close and check the pipeline.";
const PIPELINE_REFRESH_ERROR_MESSAGE = "We could not confirm the latest pipeline yet. Adding and moving prospects remain paused so an older snapshot cannot overwrite your work.";
const PIPELINE_TRANSITION_RECOVERY_MESSAGE = "We could not confirm that move. The pipeline is refreshing before any more changes.";
const MAX_AUTHORITY_READS = 4;

type ContactLite = { id: OrganizationContactId; name: string; email: string; company: string | null };
type AddProspectAttempt = {
  body: CreateCrmPipelineEntryInput & { id: CrmPipelineId };
  contact: OrganizationContactSummaryDTO;
};
type AddProspectRecovery = {
  attempt: AddProspectAttempt;
  confirmedEntry: CrmPipelineEntryDTO | null;
  closeOnly: boolean;
};
type PipelineAuthority = { entries: CrmPipelineEntryDTO[]; contacts: Record<string, ContactLite> };

export function pipelineTransitionNeedsAuthority(error: unknown): boolean {
  return !isDefinitiveWriteFailure(error)
    || (isAppError(error) && (error.code === "STALE_WRITE" || error.code === "CONFLICT"));
}

function canonicalContactCloseOnly(error: unknown): boolean {
  return isAppError(error) && ["NOT_FOUND", "UNAUTHORIZED", "FORBIDDEN"].includes(error.code);
}

function canonicalContactRecoveryMessage(error: unknown): string {
  if (isAppError(error) && error.code === "NOT_FOUND") {
    return "The prospect was added, but its current contact is no longer available. Close and check the pipeline for the latest state.";
  }
  if (isAppError(error) && (error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN")) {
    return "The prospect was added, but your access changed before its current contact could be loaded. Close and check the pipeline after restoring access.";
  }
  return CONTACT_REFRESH_RECOVERY_MESSAGE;
}

async function fetchPipelineEntries(organizationId: OrganizationId): Promise<CrmPipelineEntryDTO[]> {
  return api(`organizations/${organizationId}/crm/pipeline`, crmPipelineEntryDtoSchema.array());
}

async function fetchContact(organizationId: OrganizationId, contactId: OrganizationContactId): Promise<OrganizationContactDTO> {
  const history = await api(
    `organizations/${organizationId}/crm/contacts/${contactId}`,
    organizationContactHistoryDtoSchema,
  );
  if (history.contact.id !== contactId) {
    throw new AppError("INTERNAL", "The current contact response did not match the requested contact");
  }
  return history.contact;
}

function samePipelineSnapshot(left: CrmPipelineEntryDTO[], right: CrmPipelineEntryDTO[]): boolean {
  const byId = (entries: CrmPipelineEntryDTO[]) => [...entries].sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(byId(left)) === JSON.stringify(byId(right));
}

async function resolveCurrentPipelineContact(
  organizationId: OrganizationId,
  recoveredEntry: CrmPipelineEntryDTO,
): Promise<{ entry: CrmPipelineEntryDTO; contact: OrganizationContactDTO }> {
  let currentEntry = recoveredEntry;
  for (let read = 0; read < MAX_AUTHORITY_READS; read += 1) {
    const before = (await fetchPipelineEntries(organizationId)).find((entry) => entry.id === currentEntry.id);
    if (!before) throw new AppError("NOT_FOUND", "The recovered pipeline entry is no longer available");
    const contact = await fetchContact(organizationId, before.organizationContactId);
    const after = (await fetchPipelineEntries(organizationId)).find((entry) => entry.id === currentEntry.id);
    if (!after) throw new AppError("NOT_FOUND", "The recovered pipeline entry is no longer available");
    if (contact.mergedIntoId === null && after.organizationContactId === contact.id) {
      return { entry: after, contact };
    }
    currentEntry = after;
  }
  throw new AppError("INTERNAL", "The prospect’s contact kept changing while the pipeline was refreshed");
}

async function loadPipelineAuthority(organizationId: OrganizationId): Promise<PipelineAuthority> {
  for (let read = 0; read < MAX_AUTHORITY_READS; read += 1) {
    const entries = await fetchPipelineEntries(organizationId);
    const contactIds = [...new Set(entries.map((entry) => entry.organizationContactId))];
    const contactRows = await Promise.all(contactIds.map((contactId) => fetchContact(organizationId, contactId)));
    const verifiedEntries = await fetchPipelineEntries(organizationId);
    if (!samePipelineSnapshot(entries, verifiedEntries) || contactRows.some((contact) => contact.mergedIntoId !== null)) continue;
    const contacts: Record<string, ContactLite> = {};
    for (const contact of contactRows) {
      contacts[contact.id] = {
        id: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim() || contact.email,
        email: contact.email,
        company: contact.company,
      };
    }
    return { entries: verifiedEntries, contacts };
  }
  throw new AppError("INTERNAL", "The pipeline kept changing while it was refreshed");
}

function Card({ entry, contact, eventName, mutationsBlocked, onMove }: { entry: CrmPipelineEntryDTO; contact: ContactLite | undefined; eventName: string | null; mutationsBlocked: boolean; onMove: (stage: CrmPipelineStage) => void }) {
  // dnd-kit's `attributes` are ARIA only — dragging needs `setNodeRef` and the
  // listeners. Spreading them here made every card a `role="button" tabindex="0"`
  // tab stop with no keyboard activation (the board registers PointerSensor
  // only) and nested the stage <Select> below inside a button. That Select is
  // the pointer-free path, so the card takes the drag listeners and nothing else.
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({ id: entry.id, data: { entry }, disabled: mutationsBlocked });
  const style: CSSProperties = { transform: transform ? CSS.Translate.toString(transform) : undefined };
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "crm-board-card crm-board-card--dragging" : "crm-board-card"} {...listeners}>
      <b>{contact?.name ?? "Unknown contact"}</b>
      <span>{contact?.email}{contact?.company ? ` · ${contact.company}` : ""}</span>
      {eventName && <span>Target: {eventName}</span>}
      {entry.notes && <span>{entry.notes}</span>}
      <div className="crm-board-card-actions" onPointerDown={(event) => event.stopPropagation()}>
        <Select aria-label={`Move ${contact?.name ?? "this prospect"} to a different stage`} value={entry.stage} disabled={mutationsBlocked} onChange={(event) => onMove(event.target.value as CrmPipelineStage)}>
          {CRM_PIPELINE_STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABEL[stage]}</option>)}
        </Select>
      </div>
    </div>
  );
}

function Column({ stage, entries, contactsById, eventNameById, mutationsBlocked, pendingEntryIds, onMove }: {
  stage: CrmPipelineStage;
  entries: CrmPipelineEntryDTO[];
  contactsById: Record<string, ContactLite>;
  eventNameById: Record<string, string>;
  mutationsBlocked: boolean;
  pendingEntryIds: ReadonlySet<string>;
  onMove: (entryId: string, stage: CrmPipelineStage) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, disabled: mutationsBlocked });
  return (
    <div ref={setNodeRef} className={isOver ? "crm-board-column crm-board-column--over" : "crm-board-column"}>
      <div className="crm-board-column-header"><b>{STAGE_LABEL[stage]}</b><span>{entries.length}</span></div>
      <div className="crm-board-cards">
        {entries.length === 0 && <p className="crm-board-empty">Nothing here yet.</p>}
        {entries.map((entry) => (
          <Card
            key={entry.id}
            entry={entry}
            contact={contactsById[entry.organizationContactId]}
            eventName={entry.targetEventId ? eventNameById[entry.targetEventId] ?? null : null}
            mutationsBlocked={mutationsBlocked || pendingEntryIds.has(entry.id)}
            onMove={(nextStage) => onMove(entry.id, nextStage)}
          />
        ))}
      </div>
    </div>
  );
}

function AddProspectDialog({ organizationId, events, open, onClose, onCreated }: {
  organizationId: OrganizationId;
  events: OrganizationEventRow[];
  open: boolean;
  onClose: (checkPipeline: boolean) => void;
  onCreated: (entry: CrmPipelineEntryDTO, contact: OrganizationContactDTO) => void;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OrganizationContactSummaryDTO[]>([]);
  const [picked, setPicked] = useState<OrganizationContactSummaryDTO | null>(null);
  const [targetEventId, setTargetEventId] = useState("");
  const [notes, setNotes] = useState("");
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<AddProspectRecovery | null>(null);
  const createRequestId = useRef(createStableCreateRequestId());

  function reset() {
    setQuery(""); setResults([]); setPicked(null); setTargetEventId(""); setNotes(""); setError(""); setRecovery(null);
    createRequestId.current.reset();
  }

  function requestClose() {
    if (busy) return;
    const shouldCheckPipeline = recovery !== null;
    reset();
    onClose(shouldCheckPipeline);
  }

  async function search() {
    // The failure copy tells the organizer to press Enter to try again, so the
    // reset has to happen before the empty-query guard — otherwise an emptied
    // search box leaves a stale alert that Enter cannot clear.
    setResults([]);
    setError("");
    if (!query.trim()) return;
    setSearching(true);
    try {
      const page = await api(`organizations/${organizationId}/crm/contacts?search=${encodeURIComponent(query)}&limit=8`, directoryPageDtoSchema);
      setResults(page.rows);
    } catch (caught) {
      // A failed lookup must never look like "nobody matches that": clear the
      // previous query's rows and say the search itself did not run.
      setResults([]);
      const message = isAppError(caught) ? caught.message : "Could not search the directory — press Enter to try again";
      setError(message);
      toast(message, { kind: "error" });
    } finally {
      setSearching(false);
    }
  }

  async function create() {
    if ((!picked && !recovery) || busy) return;
    const contact = recovery?.attempt.contact ?? picked;
    if (!contact) return;
    const attempt: AddProspectAttempt = recovery?.attempt ?? {
      body: {
        id: crmPipelineIdSchema.parse(createRequestId.current.begin()),
        organizationContactId: contact.id,
        targetEventId: targetEventId ? eventIdSchema.parse(targetEventId) : undefined,
        notes: notes || undefined,
      },
      contact,
    };
    setBusy(true);
    setError("");
    let confirmedEntry = recovery?.confirmedEntry ?? null;
    try {
      if (!confirmedEntry) {
        confirmedEntry = await api(`organizations/${organizationId}/crm/pipeline`, crmPipelineEntryDtoSchema, {
          method: "POST",
          body: attempt.body,
        });
      }
      const resolved = await resolveCurrentPipelineContact(organizationId, confirmedEntry);
      onCreated(resolved.entry, resolved.contact);
      toast("Added to the pipeline");
      reset();
      onClose(false);
    } catch (caught) {
      if (confirmedEntry) {
        const message = canonicalContactRecoveryMessage(caught);
        setRecovery({ attempt, confirmedEntry, closeOnly: canonicalContactCloseOnly(caught) });
        setError(message);
        toast(message, { kind: "error" });
        return;
      }
      const outcomeUnknown = !isDefinitiveWriteFailure(caught);
      if (outcomeUnknown) setRecovery({ attempt, confirmedEntry: null, closeOnly: false });
      else {
        setRecovery(null);
        createRequestId.current.reset();
      }
      const message = outcomeUnknown
        ? CREATE_RECOVERY_MESSAGE
        : isAppError(caught) ? caught.message : "Could not add that prospect";
      setError(message);
      toast(message, { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title="Add a prospect"
      description="Search the directory for who you’re sourcing, then optionally name the event you have in mind."
      footer={<>
        <Button variant="secondary" onClick={requestClose} disabled={busy}>{recovery ? "Close and check pipeline" : "Cancel"}</Button>
        {!recovery?.closeOnly && (
          <Button disabled={(!picked && !recovery) || busy} onClick={() => void create()}>
            {busy
              ? recovery?.confirmedEntry ? "Refreshing…" : recovery ? "Retrying…" : "Adding…"
              : recovery?.confirmedEntry ? "Retry contact refresh" : recovery ? "Retry addition" : "Add to pipeline"}
          </Button>
        )}
      </>}
    >
      {error && <p className="portal-note" role="alert">{error}</p>}
      <fieldset disabled={busy || recovery !== null} style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}>
        <div className="form-stack">
          {!picked ? (
            <>
              <form className="table-search" style={{ width: "100%" }} onSubmit={(event) => { event.preventDefault(); void search(); }}>
                <Search size={16} />
                <input aria-label="Search the directory" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the directory" autoFocus />
              </form>
              {searching && <p className="long-copy">Searching…</p>}
              {!searching && results.map((row) => (
                <button key={row.id} type="button" className="speaker-card" style={{ width: "100%", textAlign: "left" }} onClick={() => setPicked(row)}>
                  <span className="speaker-card-copy" style={{ gridColumn: "1/3" }}><b>{`${row.firstName} ${row.lastName}`.trim() || row.email}</b><span>{row.email}</span></span>
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="notify-bar">
                <div><p><b>{`${picked.firstName} ${picked.lastName}`.trim() || picked.email}</b><small>{picked.email}</small></p></div>
                <button type="button" onClick={() => setPicked(null)} style={{ border: 0, background: "transparent", color: "var(--muted)", fontSize: "var(--text-xs)" }}>Change</button>
              </div>
              <Field label="Target event" hint="Optional.">
                <Select value={targetEventId} onChange={(event) => setTargetEventId(event.target.value)}>
                  <option value="">No specific event yet</option>
                  {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
                </Select>
              </Field>
              <Field label="Notes" hint="Optional.">
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
              </Field>
            </>
          )}
        </div>
      </fieldset>
    </Modal>
  );
}

/**
 * M55 — the sourcing kanban (AC: "Move a prospect through open/won/lost
 * states and verify timestamped history"). Drag between columns
 * (`@dnd-kit/core`, the same library the agenda day-grid already depends on)
 * moves a card; each card also carries a plain `<Select>` dropdown as the pointer-free
 * path to the identical `transitionCrmPipeline` call, since dnd-kit's drag
 * gesture has no keyboard equivalent on its own.
 */
export function PipelineBoard({
  organizationId,
  initialEntries,
  contactsById,
  events,
}: {
  organizationId: OrganizationId;
  initialEntries: CrmPipelineEntryDTO[];
  contactsById: Record<string, ContactLite>;
  events: OrganizationEventRow[];
}) {
  const { toast } = useToast();
  const [entries, setEntries] = useState(initialEntries);
  const [contacts, setContacts] = useState(contactsById);
  const [addOpen, setAddOpen] = useState(false);
  const [authorityRefresh, setAuthorityRefresh] = useState<"pending" | "failed" | null>(null);
  const [pendingEntryIds, setPendingEntryIds] = useState<ReadonlySet<string>>(() => new Set());
  const mutationsBlockedRef = useRef(false);
  const authorityRefreshInFlightRef = useRef(false);
  const pendingMutationsRef = useRef(new Set<Promise<void>>());
  const pendingEntryIdsRef = useRef(new Set<string>());
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const eventNameById = Object.fromEntries(events.map((event) => [event.id, event.name]));
  const mutationsBlocked = authorityRefresh !== null;

  // Fold later server-component authority into the mounted board. Recovery
  // close uses the explicit barrier below instead of router.refresh(), because
  // a late RSC snapshot must never overwrite a mutation made after close.
  useEffect(() => setEntries(initialEntries), [initialEntries]);
  useEffect(() => setContacts(contactsById), [contactsById]);

  async function drainPendingMutations() {
    while (pendingMutationsRef.current.size > 0) {
      await Promise.allSettled([...pendingMutationsRef.current]);
    }
  }

  async function refreshAuthority() {
    if (authorityRefreshInFlightRef.current) return;
    // The ref closes the same-tick gap before React paints disabled controls.
    // A stage mutation that already owns a promise is allowed to finish; no
    // authority read starts until every such promise has settled.
    mutationsBlockedRef.current = true;
    authorityRefreshInFlightRef.current = true;
    setAuthorityRefresh("pending");
    try {
      await drainPendingMutations();
      const authority = await loadPipelineAuthority(organizationId);
      setEntries(authority.entries);
      setContacts(authority.contacts);
      mutationsBlockedRef.current = false;
      setAuthorityRefresh(null);
    } catch (caught) {
      setAuthorityRefresh("failed");
      toast(isAppError(caught) ? caught.message : PIPELINE_REFRESH_ERROR_MESSAGE, { kind: "error" });
    } finally {
      authorityRefreshInFlightRef.current = false;
    }
  }

  function move(entryId: string, stage: CrmPipelineStage) {
    if (mutationsBlockedRef.current || pendingEntryIdsRef.current.has(entryId)) return;
    const current = entries.find((entry) => entry.id === entryId);
    if (!current || current.stage === stage) return;
    pendingEntryIdsRef.current.add(entryId);
    setPendingEntryIds(new Set(pendingEntryIdsRef.current));
    setEntries((rows) => rows.map((row) => row.id === entryId ? { ...row, stage } : row));
    let needsAuthorityRefresh = false;
    const mutation = (async () => {
      try {
        const updated = await api(`organizations/${organizationId}/crm/pipeline/${entryId}/transition`, crmPipelineEntryDtoSchema, {
          method: "POST",
          body: { stage, expectedFrom: current.stage, expectedUpdatedAt: current.updatedAt },
        });
        setEntries((rows) => rows.map((row) => row.id === entryId ? updated : row));
      } catch (caught) {
        if (pipelineTransitionNeedsAuthority(caught)) {
          // Block synchronously before React paints. The authority reader starts
          // only after this promise is removed from the drain set below, which
          // avoids waiting on itself while still draining every other mutation.
          needsAuthorityRefresh = true;
          mutationsBlockedRef.current = true;
          setAuthorityRefresh("pending");
          toast(
            isDefinitiveWriteFailure(caught)
              ? `${caught.message}${/[.!?]$/u.test(caught.message) ? "" : "."} The pipeline is refreshing.`
              : PIPELINE_TRANSITION_RECOVERY_MESSAGE,
            { kind: "error" },
          );
          return;
        }
        // The server definitively refused this request. Roll back this card
        // only if it still carries our optimistic stage/version; never replace
        // a later confirmed response for the same entry.
        setEntries((rows) => rows.map((row) => row.id === entryId && row.stage === stage && row.updatedAt === current.updatedAt ? current : row));
        toast(isAppError(caught) ? caught.message : "That move did not save", { kind: "error" });
      }
    })();
    pendingMutationsRef.current.add(mutation);
    void mutation.then(() => {
      pendingMutationsRef.current.delete(mutation);
      pendingEntryIdsRef.current.delete(entryId);
      setPendingEntryIds(new Set(pendingEntryIdsRef.current));
      if (needsAuthorityRefresh) void refreshAuthority();
    });
  }

  function onDragEnd(event: DragEndEvent) {
    if (mutationsBlocked) return;
    if (!event.over) return;
    const stage = event.over.id as CrmPipelineStage;
    if (!(CRM_PIPELINE_STAGES as readonly string[]).includes(stage)) return;
    move(String(event.active.id), stage);
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="ORGANIZATION"
        title="Speaker CRM"
        description="Track prospects from first contact to a confirmed speaker."
        actions={<Button disabled={mutationsBlocked} onClick={() => { if (!mutationsBlockedRef.current) setAddOpen(true); }}><Plus size={15} /> Add prospect</Button>}
      />
      <CrmNav organizationId={organizationId} active="pipeline" />

      {authorityRefresh && (
        <div className="notify-bar" role={authorityRefresh === "failed" ? "alert" : "status"}>
          <p>
            <b>{authorityRefresh === "pending" ? "Refreshing the pipeline…" : "Pipeline refresh needs another try"}</b>
            <small>{authorityRefresh === "pending" ? "Prospect changes are paused until the latest server state arrives." : PIPELINE_REFRESH_ERROR_MESSAGE}</small>
          </p>
          {authorityRefresh === "failed" && <Button variant="secondary" onClick={() => void refreshAuthority()}>Retry refresh</Button>}
        </div>
      )}

      {entries.length === 0 ? (
        <EmptyState
          icon={<Kanban size={20} />}
          title="No prospects yet"
          description="Add your first prospect to track them through open, won, and lost."
          action={<Button disabled={mutationsBlocked} onClick={() => { if (!mutationsBlockedRef.current) setAddOpen(true); }}><Plus size={15} /> Add prospect</Button>}
        />
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="crm-board">
            {CRM_PIPELINE_STAGES.map((stage) => (
              <Column
                key={stage}
                stage={stage}
                entries={entries.filter((entry) => entry.stage === stage)}
                contactsById={contacts}
                eventNameById={eventNameById}
                mutationsBlocked={mutationsBlocked}
                pendingEntryIds={pendingEntryIds}
                onMove={(entryId, nextStage) => move(entryId, nextStage)}
              />
            ))}
          </div>
        </DndContext>
      )}

      {entries.length > 0 && (
        <p className="long-copy" style={{ marginTop: 16 }}>
          Cards link back to <Link href={`/organizations/${organizationId}/crm`}>the directory</Link> for full history.
        </p>
      )}

      <AddProspectDialog
        organizationId={organizationId}
        events={events}
        open={addOpen}
        onClose={(checkPipeline) => {
          setAddOpen(false);
          if (checkPipeline) void refreshAuthority();
        }}
        onCreated={(entry, contact) => {
          setEntries((rows) => [entry, ...rows.filter((row) => row.id !== entry.id)]);
          setContacts((current) => ({ ...current, [contact.id]: { id: contact.id, name: `${contact.firstName} ${contact.lastName}`.trim() || contact.email, email: contact.email, company: contact.company } }));
        }}
      />
    </main>
  );
}
