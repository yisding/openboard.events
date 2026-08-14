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
import { useRouter } from "next/navigation";
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
import { AppError, isAppError } from "@/shared/lib/errors";
import { createStableCreateRequestId } from "@/shared/lib/stable-create-request-id";
import { CrmNav } from "./crm-nav";

const STAGE_LABEL: Record<CrmPipelineStage, string> = { open: "Open", won: "Won", lost: "Lost" };
const CREATE_RECOVERY_MESSAGE = "We could not confirm whether this prospect was added. Its details are locked so Retry addition can safely recover the same attempt. You can also close and check the pipeline.";
const CONTACT_REFRESH_RECOVERY_MESSAGE = "The prospect was added, but we could not load its current contact after a merge. Retry the contact refresh, or close and check the pipeline.";

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

export function pipelineCreateOutcomeUnknown(error: unknown): boolean {
  return !isAppError(error) || error.code === "INTERNAL";
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

function Card({ entry, contact, eventName, onMove }: { entry: CrmPipelineEntryDTO; contact: ContactLite | undefined; eventName: string | null; onMove: (stage: CrmPipelineStage) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: entry.id, data: { entry } });
  const style: CSSProperties = { transform: transform ? CSS.Translate.toString(transform) : undefined };
  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "crm-board-card crm-board-card--dragging" : "crm-board-card"} {...listeners} {...attributes}>
      <b>{contact?.name ?? "Unknown contact"}</b>
      <span>{contact?.email}{contact?.company ? ` · ${contact.company}` : ""}</span>
      {eventName && <span>Target: {eventName}</span>}
      {entry.notes && <span>{entry.notes}</span>}
      <div className="crm-board-card-actions" onPointerDown={(event) => event.stopPropagation()}>
        <Select aria-label={`Move ${contact?.name ?? "this prospect"} to a different stage`} value={entry.stage} onChange={(event) => onMove(event.target.value as CrmPipelineStage)}>
          {CRM_PIPELINE_STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABEL[stage]}</option>)}
        </Select>
      </div>
    </div>
  );
}

function Column({ stage, entries, contactsById, eventNameById, onMove }: {
  stage: CrmPipelineStage;
  entries: CrmPipelineEntryDTO[];
  contactsById: Record<string, ContactLite>;
  eventNameById: Record<string, string>;
  onMove: (entryId: string, stage: CrmPipelineStage) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
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
  onClose: () => void;
  onCreated: (entry: CrmPipelineEntryDTO, contact: OrganizationContactDTO) => void;
}) {
  const router = useRouter();
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
    onClose();
    if (shouldCheckPipeline) router.refresh();
  }

  async function search() {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const page = await api(`organizations/${organizationId}/crm/contacts?search=${encodeURIComponent(query)}&limit=8`, directoryPageDtoSchema);
      setResults(page.rows);
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
      let currentContact: OrganizationContactDTO = attempt.contact;
      if (confirmedEntry.organizationContactId !== attempt.contact.id) {
        const history = await api(
          `organizations/${organizationId}/crm/contacts/${confirmedEntry.organizationContactId}`,
          organizationContactHistoryDtoSchema,
        );
        if (history.contact.id !== confirmedEntry.organizationContactId) {
          throw new AppError("INTERNAL", "The current contact response did not match the recovered prospect");
        }
        currentContact = history.contact;
      }
      onCreated(confirmedEntry, currentContact);
      toast("Added to the pipeline");
      reset();
      onClose();
    } catch (caught) {
      if (confirmedEntry) {
        const message = canonicalContactRecoveryMessage(caught);
        setRecovery({ attempt, confirmedEntry, closeOnly: canonicalContactCloseOnly(caught) });
        setError(message);
        toast(message, { kind: "error" });
        return;
      }
      const outcomeUnknown = pipelineCreateOutcomeUnknown(caught);
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
      description="Search the directory for who you're sourcing, then optionally name the event you have in mind."
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const eventNameById = Object.fromEntries(events.map((event) => [event.id, event.name]));

  // A recovery close refreshes the server component. Fold that authority into
  // the still-mounted board so a committed response-loss attempt becomes
  // visible without a hard reload.
  useEffect(() => setEntries(initialEntries), [initialEntries]);
  useEffect(() => setContacts(contactsById), [contactsById]);

  async function move(entryId: string, stage: CrmPipelineStage) {
    const previous = entries;
    const current = entries.find((entry) => entry.id === entryId);
    if (!current || current.stage === stage) return;
    setEntries((rows) => rows.map((row) => row.id === entryId ? { ...row, stage } : row));
    try {
      const updated = await api(`organizations/${organizationId}/crm/pipeline/${entryId}/transition`, crmPipelineEntryDtoSchema, { method: "POST", body: { stage } });
      setEntries((rows) => rows.map((row) => row.id === entryId ? updated : row));
    } catch (caught) {
      setEntries(previous);
      toast(isAppError(caught) ? caught.message : "That move did not save");
    }
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const stage = event.over.id as CrmPipelineStage;
    if (!(CRM_PIPELINE_STAGES as readonly string[]).includes(stage)) return;
    void move(String(event.active.id), stage);
  }

  return (
    <main className="page">
      <PageHeader
        eyebrow="ORGANIZATION"
        title="Speaker CRM"
        description="Track prospects from first contact to a confirmed speaker."
        actions={<Button onClick={() => setAddOpen(true)}><Plus size={15} /> Add prospect</Button>}
      />
      <CrmNav organizationId={organizationId} active="pipeline" />

      {entries.length === 0 ? (
        <EmptyState icon={<Kanban size={20} />} title="No prospects yet" description="Add a contact to start tracking them through open, won, and lost." />
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
                onMove={(entryId, nextStage) => void move(entryId, nextStage)}
              />
            ))}
          </div>
        </DndContext>
      )}

      <p className="long-copy" style={{ marginTop: 16 }}>
        Cards link back to <Link href={`/organizations/${organizationId}/crm`}>the directory</Link> for full history.
      </p>

      <AddProspectDialog
        organizationId={organizationId}
        events={events}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(entry, contact) => {
          setEntries((rows) => [entry, ...rows.filter((row) => row.id !== entry.id)]);
          setContacts((current) => ({ ...current, [contact.id]: { id: contact.id, name: `${contact.firstName} ${contact.lastName}`.trim() || contact.email, email: contact.email, company: contact.company } }));
        }}
      />
    </main>
  );
}
