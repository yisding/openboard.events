"use client";

import { Layers, Mail, Plus, Sparkles, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OrganizationEventRow } from "@/features/organizations";
import { bulkSendRecoveryStorageKey, loadBulkSendRecovery, type BulkSendRecoverySnapshot } from "@/features/comms/bulk-send-recovery";
import { UnreadableBulkSendRecovery } from "@/features/comms/components/unreadable-bulk-send-recovery";
import {
  CRM_CONTACT_SOURCES,
  CRM_PIPELINE_STAGES,
  crmSegmentDtoSchema,
  directoryPageDtoSchema,
  resolvedCrmSegmentSchema,
  type CrmSegmentDTO,
  type CrmSegmentFilter,
  type CrmTagDTO,
  type OrganizationContactId,
  type OrganizationId,
  type ResolvedCrmSegment,
} from "@/shared/contracts";
import { Button, EmptyState, Field, Modal, PageHeader } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { CrmNav } from "./crm-nav";
import { CrmBulkEmailDialog } from "./crm-bulk-email-dialog";

const EMPTY_FILTER: CrmSegmentFilter = {};

export function updatePendingSegmentIds(current: ReadonlySet<string>, segmentId: string, pending: boolean): ReadonlySet<string> {
  const next = new Set(current);
  if (pending) next.add(segmentId);
  else next.delete(segmentId);
  return next;
}

/** Returns a predicate that stays true only until a newer request begins. */
export function beginLatestRequest(sequence: { current: number }): () => boolean {
  const requestId = sequence.current + 1;
  sequence.current = requestId;
  return () => sequence.current === requestId;
}

export async function resolveCrmEmailAudience(load: () => Promise<ResolvedCrmSegment>): Promise<{
  result: ResolvedCrmSegment | null;
  error: string | null;
}> {
  try {
    const result = await load();
    return result.organizationContactIds.length > 0
      ? { result, error: null }
      : { result, error: "No contacts currently match this segment" };
  } catch (caught) {
    return { result: null, error: isAppError(caught) ? caught.message : "Could not resolve this segment — try again" };
  }
}

function filterSummary(filter: CrmSegmentFilter, tags: CrmTagDTO[], events: OrganizationEventRow[]): string {
  const parts: string[] = [];
  if (filter.search) parts.push(`"${filter.search}"`);
  if (filter.tagIds?.length) parts.push(filter.tagIds.map((id) => tags.find((tag) => tag.id === id)?.name ?? id).join(" + "));
  if (filter.eventIds?.length) parts.push(filter.eventIds.map((id) => events.find((event) => event.id === id)?.name ?? id).join(" or "));
  if (filter.pipelineStage?.length) parts.push(`pipeline: ${filter.pipelineStage.join(", ")}`);
  if (filter.source?.length) parts.push(`source: ${filter.source.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : "Everyone in the directory";
}

function toggleInArray<T>(current: T[] | undefined, value: T): T[] | undefined {
  const list = current ?? [];
  const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  return next.length > 0 ? next : undefined;
}

function SegmentBuilderModal({ organizationId, tags, events, open, onClose, onCreated }: {
  organizationId: OrganizationId;
  tags: CrmTagDTO[];
  events: OrganizationEventRow[];
  open: boolean;
  onClose: () => void;
  onCreated: (segment: CrmSegmentDTO) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [filter, setFilter] = useState<CrmSegmentFilter>(EMPTY_FILTER);
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  function reset() {
    setName(""); setFilter(EMPTY_FILTER); setPreviewTotal(null);
  }

  async function preview() {
    setPreviewing(true);
    try {
      const params = new URLSearchParams();
      if (filter.search) params.set("search", filter.search);
      if (filter.tagIds?.length) params.set("tagIds", filter.tagIds.join(","));
      if (filter.eventIds?.length) params.set("eventIds", filter.eventIds.join(","));
      if (filter.pipelineStage?.length) params.set("pipelineStage", filter.pipelineStage.join(","));
      if (filter.source?.length) params.set("source", filter.source.join(","));
      params.set("limit", "1");
      const page = await api(`organizations/${organizationId}/crm/contacts?${params.toString()}`, directoryPageDtoSchema);
      setPreviewTotal(page.total);
    } catch {
      setPreviewTotal(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const segment = await api(`organizations/${organizationId}/crm/segments`, crmSegmentDtoSchema, { method: "POST", body: { name, filter } });
      onCreated(segment);
      toast(`Segment "${name}" saved`);
      reset();
      onClose();
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That segment did not save", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="New segment"
      description="Saved as a live filter, not a snapshot — membership is resolved fresh every time you view or email it."
      wide
      footer={<>
        <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={busy}>Cancel</Button>
        <Button disabled={!name.trim() || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save segment"}</Button>
      </>}
    >
      <div className="form-stack">
        <Field label="Name" required>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Warm AI leads" autoFocus />
        </Field>
        <Field label="Search text" hint="Matches name, email, or company.">
          <input value={filter.search ?? ""} onChange={(event) => setFilter((current) => ({ ...current, search: event.target.value || undefined }))} />
        </Field>
        <Field label="Tags" hint="A contact must have every tag selected here." group>
          <div className="chip-picker">
            {tags.length === 0 && <p className="long-copy">No tags yet.</p>}
            {tags.map((tag) => (
              <button key={tag.id} type="button" aria-pressed={filter.tagIds?.includes(tag.id) ?? false} className={filter.tagIds?.includes(tag.id) ? "chip chip--selected" : "chip"} onClick={() => setFilter((current) => ({ ...current, tagIds: toggleInArray(current.tagIds, tag.id) }))}>
                {tag.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Events" hint="Linked to any of these." group>
          <div className="chip-picker">
            {events.map((event) => (
              <button key={event.id} type="button" aria-pressed={filter.eventIds?.includes(event.id) ?? false} className={filter.eventIds?.includes(event.id) ? "chip chip--selected" : "chip"} onClick={() => setFilter((current) => ({ ...current, eventIds: toggleInArray(current.eventIds, event.id) }))}>
                {event.name}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Pipeline stage" group>
          <div className="chip-picker">
            {CRM_PIPELINE_STAGES.map((stage) => (
              <button key={stage} type="button" aria-pressed={filter.pipelineStage?.includes(stage) ?? false} className={filter.pipelineStage?.includes(stage) ? "chip chip--selected" : "chip"} onClick={() => setFilter((current) => ({ ...current, pipelineStage: toggleInArray(current.pipelineStage, stage) }))}>
                {stage}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Source" group>
          <div className="chip-picker">
            {CRM_CONTACT_SOURCES.map((source) => (
              <button key={source} type="button" aria-pressed={filter.source?.includes(source) ?? false} className={filter.source?.includes(source) ? "chip chip--selected" : "chip"} onClick={() => setFilter((current) => ({ ...current, source: toggleInArray(current.source, source) }))}>
                {source.replaceAll("_", " ")}
              </button>
            ))}
          </div>
        </Field>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button size="sm" variant="secondary" onClick={() => void preview()} disabled={previewing}><Sparkles size={14} /> {previewing ? "Checking…" : "Preview match count"}</Button>
          {previewTotal !== null && <span style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>{previewTotal} contact{previewTotal === 1 ? "" : "s"} match right now</span>}
        </div>
      </div>
    </Modal>
  );
}

/**
 * M55 — saved dynamic segments (AC: "Save a dynamic segment, observe
 * membership change after an underlying field edit, and bulk-compose to it
 * with suppression/unsubscribe enforcement" — the last half comes free from
 * `CrmBulkEmailDialog` delegating to M51's outbox). Nothing here caches
 * membership: every "View members" resolves the stored filter fresh
 * (`GET .../segments/[id]/resolve`), which is the mechanism that makes the
 * "membership changes after a field edit" behavior true without any extra
 * code on this page.
 */
export function SegmentsView({
  organizationId,
  initialSegments,
  tags,
  events,
}: {
  organizationId: OrganizationId;
  initialSegments: CrmSegmentDTO[];
  tags: CrmTagDTO[];
  events: OrganizationEventRow[];
}) {
  const { toast } = useToast();
  const [segments, setSegments] = useState(initialSegments);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [resolved, setResolved] = useState<Record<string, ResolvedCrmSegment | undefined>>({});
  const [resolvingIds, setResolvingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [emailSegment, setEmailSegment] = useState<CrmSegmentDTO | null>(null);
  const [emailRecovery, setEmailRecovery] = useState<BulkSendRecoverySnapshot | null>(null);
  const [emailRecoveryUnreadable, setEmailRecoveryUnreadable] = useState(false);
  const [emailRecoveryOpen, setEmailRecoveryOpen] = useState(false);
  useEffect(() => {
    const identity = { surface: "crm" as const, scope: organizationId };
    const storageKey = bulkSendRecoveryStorageKey(identity);
    const refreshRecovery = () => {
      const loaded = loadBulkSendRecovery(window.localStorage, identity);
      setEmailRecovery(loaded.ok ? loaded.snapshot : null);
      setEmailRecoveryUnreadable(!loaded.ok && (loaded.reason === "corrupt" || loaded.reason === "identity_mismatch"));
    };
    refreshRecovery();
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) refreshRecovery();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [organizationId]);
  const emailRequestSequence = useRef(0);

  function setResolving(segmentId: string, pending: boolean) {
    setResolvingIds((current) => updatePendingSegmentIds(current, segmentId, pending));
  }

  async function resolve(segmentId: string) {
    setResolving(segmentId, true);
    try {
      const result = await api(`organizations/${organizationId}/crm/segments/${segmentId}/resolve`, resolvedCrmSegmentSchema);
      setResolved((current) => ({ ...current, [segmentId]: result }));
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "Could not resolve this segment — try again", { kind: "error" });
    } finally {
      setResolving(segmentId, false);
    }
  }

  async function email(segment: CrmSegmentDTO) {
    const loaded = loadBulkSendRecovery(window.localStorage, { surface: "crm", scope: organizationId });
    if (!loaded.ok && (loaded.reason === "corrupt" || loaded.reason === "identity_mismatch")) {
      setEmailRecoveryUnreadable(true);
      return;
    }
    const storedRecovery = loaded.ok ? loaded.snapshot : null;
    setEmailRecovery(storedRecovery);
    if (storedRecovery) {
      setEmailRecovery(storedRecovery);
      setEmailRecoveryOpen(true);
      return;
    }
    const isLatestRequest = beginLatestRequest(emailRequestSequence);
    setResolving(segment.id, true);
    setEmailSegment(null);
    try {
      const outcome = await resolveCrmEmailAudience(() => api(
        `organizations/${organizationId}/crm/segments/${segment.id}/resolve`,
        resolvedCrmSegmentSchema,
      ));
      if (outcome.result) setResolved((current) => ({ ...current, [segment.id]: outcome.result as ResolvedCrmSegment }));
      if (!isLatestRequest()) return;
      if (outcome.error) {
        toast(outcome.error, { kind: "error" });
        return;
      }
      setEmailSegment(segment);
    } finally {
      setResolving(segment.id, false);
    }
  }

  const emailRecipients = emailSegment ? (() => {
    const result = resolved[emailSegment.id];
    if (!result) return [];
    const previewById = new Map(result.preview.map((row) => [row.organizationContactId, row]));
    return result.organizationContactIds.map((id): { id: OrganizationContactId; name: string; email: string } => {
      const found = previewById.get(id);
      return found ? { id, name: found.name, email: found.email } : { id, name: id, email: "" };
    });
  })() : [];
  // Only the server's resolved preview sample (first `PREVIEW_SAMPLE`, 50 in
  // queries.ts) carries a real name/email. `emailRecipients` above falls
  // back to the raw id past that point so the send count/payload stay
  // correct, but that fallback is unreadable as a person's name — cap what
  // the dialog's "Preview recipient" picker renders to the rows that
  // actually have one.
  const previewRecipients = emailSegment ? (resolved[emailSegment.id]?.preview.map((row) => ({ id: row.organizationContactId, name: row.name, email: row.email })) ?? []) : [];

  return (
    <main className="page">
      <PageHeader
        eyebrow="ORGANIZATION"
        title="Speaker CRM"
        description="Saved filters over the directory — reused for review and bulk email."
        actions={<Button onClick={() => setBuilderOpen(true)}><Plus size={15} /> New segment</Button>}
      />
      <CrmNav organizationId={organizationId} active="segments" />

      {emailRecoveryUnreadable && <UnreadableBulkSendRecovery
        identity={{ surface: "crm", scope: organizationId }}
        onCleared={() => setEmailRecoveryUnreadable(false)}
      />}

      {emailRecovery && !emailRecoveryOpen && !emailSegment && <div className="notify-bar" role="status">
        <div><p>
          <b>{emailRecovery.confirmedResult ? "Completed CRM email needs cleanup" : "Unconfirmed CRM email"}</b>
          <small>{emailRecovery.confirmedResult ? "The send is complete. Reopen it to clear the saved browser recovery record." : "Resume the unchanged send to learn what queued without emailing anyone twice."}</small>
        </p></div>
        <Button size="sm" onClick={() => setEmailRecoveryOpen(true)}>{emailRecovery.confirmedResult ? "Finish cleanup" : "Resume unconfirmed email"}</Button>
      </div>}

      {segments.length === 0 ? (
        <EmptyState icon={<Layers size={20} />} title="No segments yet" description="Save a filter from the directory's criteria to build a reusable list." />
      ) : segments.map((segment) => {
        const result = resolved[segment.id];
        const resolving = resolvingIds.has(segment.id);
        return (
          <div className="crm-segment-card" key={segment.id}>
            <header>
              <div>
                <h3>{segment.name}</h3>
                <p>{filterSummary(segment.filter, tags, events)}</p>
              </div>
              <div className="crm-segment-card-actions">
                <Button size="sm" variant="secondary" onClick={() => void resolve(segment.id)} disabled={resolving}>
                  <Users size={14} /> {resolving ? "Resolving…" : result ? `${result.matchedCount} match` : "View members"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => void email(segment)}
                  disabled={resolving || emailRecovery !== null || emailRecoveryUnreadable}
                  title={emailRecoveryUnreadable
                    ? "Clear the unreadable email recovery before starting another send"
                    : emailRecovery ? "Resume or abandon the unconfirmed email before starting another send" : undefined}
                >
                  <Mail size={14} /> {resolving ? "Resolving…" : "Email segment"}
                </Button>
              </div>
            </header>
            {result && (
              <div className="crm-segment-preview">
                {result.preview.length === 0 && <span style={{ color: "var(--muted)", fontSize: "var(--text-xs)" }}>No contacts currently match this segment.</span>}
                {result.preview.map((row) => <span key={row.organizationContactId} className="chip">{row.name}</span>)}
                {result.capped && <span className="chip">…and more (capped at 2,000)</span>}
              </div>
            )}
          </div>
        );
      })}

      <SegmentBuilderModal
        organizationId={organizationId}
        tags={tags}
        events={events}
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        onCreated={(segment) => setSegments((current) => [segment, ...current])}
      />

      {((emailSegment && resolved[emailSegment.id]) || emailRecoveryOpen) && (
        <CrmBulkEmailDialog
          organizationId={organizationId}
          open
          recipients={emailSegment ? emailRecipients : []}
          previewRecipients={emailSegment ? previewRecipients : []}
          initialRecovery={emailRecoveryOpen ? emailRecovery : null}
          onRecoveryChange={setEmailRecovery}
          onClose={() => { setEmailSegment(null); setEmailRecoveryOpen(false); }}
        />
      )}
    </main>
  );
}
