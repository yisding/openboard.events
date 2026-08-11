"use client";

import { ArrowLeft, GitMerge, Search, Send, StickyNote } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { z } from "zod";
import type { OrganizationEventRow } from "@/features/organizations";
import {
  directoryPageDtoSchema,
  organizationContactHistoryDtoSchema,
  pushOrganizationContactToEventResultSchema,
  type CrmCustomFieldDTO,
  type CrmTagDTO,
  type EventId,
  type OrganizationContactHistoryDTO,
  type OrganizationContactId,
  type OrganizationContactSummaryDTO,
  type OrganizationId,
} from "@/shared/contracts";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { Avatar, Button, Field, Modal, PageHeader, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { CrmNav } from "./crm-nav";
import { MergeWizardDialog } from "./merge-wizard-dialog";

const ACTIVITY_LABEL: Record<string, string> = {
  created: "Contact created",
  note_added: "Note added",
  tag_added: "Tag added",
  tag_removed: "Tag removed",
  field_changed: "Fields updated",
  event_linked: "Linked to an event",
  merged_from: "Merged from another contact",
  merged_into: "Merged into another contact",
  pipeline_created: "Added to sourcing pipeline",
  pipeline_stage_changed: "Pipeline stage changed",
  email_sent: "Email sent",
  imported: "Imported from CSV",
};

const updatedSchema = z.object({ updated: z.boolean() });
const createdSchema = z.object({ created: z.boolean() });

type Tab = "overview" | "history" | "notes" | "activity";

function nameOf(contact: { firstName: string; lastName: string; email: string }): string {
  return `${contact.firstName} ${contact.lastName}`.trim() || contact.email;
}

function initialsFor(contact: { firstName: string; lastName: string; email: string }): string {
  const parts = `${contact.firstName} ${contact.lastName}`.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return contact.email.slice(0, 2).toUpperCase();
}

/** A minimal in-page search to pick the *other* contact for a merge — the
 * directory's bulk-select flow does this by checkbox instead; this is the
 * entry point when you are already looking at the one contact you know is a
 * duplicate and want to find its match. */
function MergeSearchDialog({
  organizationId,
  excludeId,
  open,
  onClose,
  onPick,
}: {
  organizationId: OrganizationId;
  excludeId: OrganizationContactId;
  open: boolean;
  onClose: () => void;
  onPick: (row: OrganizationContactSummaryDTO) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OrganizationContactSummaryDTO[]>([]);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!query.trim()) { setResults([]); return; }
    setBusy(true);
    try {
      const page = await api(`organizations/${organizationId}/crm/contacts?search=${encodeURIComponent(query)}&limit=8`, directoryPageDtoSchema);
      setResults(page.rows.filter((row) => row.id !== excludeId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Find the duplicate to merge with" description="Search by name, email, or company.">
      <div className="form-stack">
        <form className="table-search" style={{ width: "100%" }} onSubmit={(event) => { event.preventDefault(); void run(); }}>
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the directory" autoFocus />
        </form>
        {busy && <p className="long-copy">Searching…</p>}
        {!busy && results.map((row) => (
          <button key={row.id} type="button" className="speaker-card" style={{ width: "100%", textAlign: "left" }} onClick={() => onPick(row)}>
            <Avatar initials={initialsFor(row)} size="sm" />
            <span><b style={{ display: "block" }}>{nameOf(row)}</b><span>{row.email}</span></span>
          </button>
        ))}
        {!busy && query && results.length === 0 && <p className="long-copy">No other contact matches that search.</p>}
      </div>
    </Modal>
  );
}

/**
 * M55 — contact detail: complete cross-event history (AC), field/tag/custom-
 * field editing, notes, the activity timeline, push-into-event, and the
 * merge entry point. One page with tabs (`.drawer-tabs`/`.drawer-content`
 * reused outside an actual `<Drawer>` — the classes never assumed one) rather
 * than four, because this record's whole point is that it is one identity
 * across everything underneath it.
 */
export function ContactDetailView({
  organizationId,
  initialHistory,
  allTags,
  customFields,
  events,
}: {
  organizationId: OrganizationId;
  initialHistory: OrganizationContactHistoryDTO;
  allTags: CrmTagDTO[];
  customFields: CrmCustomFieldDTO[];
  events: OrganizationEventRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [history, setHistory] = useState(initialHistory);
  const [tab, setTab] = useState<Tab>("overview");
  const { contact } = history;

  const originalFields = {
    firstName: contact.firstName, lastName: contact.lastName, company: contact.company ?? "", jobTitle: contact.jobTitle ?? "",
    linkedinUrl: contact.linkedinUrl ?? "", twitterUrl: contact.twitterUrl ?? "", websiteUrl: contact.websiteUrl ?? "",
  };
  const [fields, setFields] = useState(originalFields);
  const [savingFields, setSavingFields] = useState(false);
  const [customValues, setCustomValues] = useState<Record<string, string>>(() => Object.fromEntries(customFields.map((field) => [field.key, contact.customFields[field.key] ?? ""])));
  const [savingCustom, setSavingCustom] = useState(false);
  const [tagBusy, setTagBusy] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [pushEventId, setPushEventId] = useState(events[0]?.id ?? "");
  const [pushBusy, setPushBusy] = useState(false);
  const [mergeSearchOpen, setMergeSearchOpen] = useState(false);
  const [mergeWith, setMergeWith] = useState<OrganizationContactSummaryDTO | null>(null);

  const fieldKeys = Object.keys(originalFields) as (keyof typeof originalFields)[];
  const fieldsDirty = fieldKeys.some((key) => fields[key] !== originalFields[key]);
  const customDirty = customFields.some((field) => customValues[field.key] !== (contact.customFields[field.key] ?? ""));

  async function refresh() {
    const next = await api(`organizations/${organizationId}/crm/contacts/${contact.id}`, organizationContactHistoryDtoSchema);
    setHistory(next);
  }

  async function saveFields() {
    setSavingFields(true);
    try {
      // Only the fields that actually changed, mirroring `saveCustomFields`
      // below — `updateOrganizationContactIn` (server) records every *present*
      // key as "changed" in the activity timeline regardless of whether its
      // value differs, so sending the whole controlled-form object here would
      // log every field as touched on every save.
      const patch = Object.fromEntries(fieldKeys.filter((key) => fields[key] !== originalFields[key]).map((key) => [key, fields[key]]));
      if (Object.keys(patch).length === 0) return;
      await api(`organizations/${organizationId}/crm/contacts/${contact.id}`, updatedSchema, { method: "PATCH", body: patch });
      await refresh();
      toast("Contact updated");
      router.refresh();
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That did not save");
    } finally {
      setSavingFields(false);
    }
  }

  async function saveCustomFields() {
    setSavingCustom(true);
    try {
      const patch = Object.fromEntries(customFields.filter((field) => customValues[field.key] !== (contact.customFields[field.key] ?? "")).map((field) => [field.key, customValues[field.key] ?? ""]));
      await api(`organizations/${organizationId}/crm/contacts/${contact.id}`, updatedSchema, { method: "PATCH", body: { customFields: patch } });
      await refresh();
      toast("Custom fields updated");
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That did not save");
    } finally {
      setSavingCustom(false);
    }
  }

  async function toggleTag(tagId: string) {
    if (tagBusy) return;
    const has = history.tags.some((tag) => tag.id === tagId);
    const nextIds = has ? history.tags.filter((tag) => tag.id !== tagId).map((tag) => tag.id) : [...history.tags.map((tag) => tag.id), tagId];
    setTagBusy(true);
    try {
      await api(`organizations/${organizationId}/crm/contacts/${contact.id}/tags`, updatedSchema, { method: "PUT", body: { tagIds: nextIds } });
      await refresh();
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That tag change failed");
    } finally {
      setTagBusy(false);
    }
  }

  async function addNote() {
    if (!noteBody.trim() || noteBusy) return;
    setNoteBusy(true);
    try {
      await api(`organizations/${organizationId}/crm/contacts/${contact.id}/notes`, createdSchema, { method: "POST", body: { bodyHtml: noteBody } });
      setNoteBody("");
      await refresh();
      toast("Note added");
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That note did not save");
    } finally {
      setNoteBusy(false);
    }
  }

  async function pushToEvent() {
    if (!pushEventId || pushBusy) return;
    setPushBusy(true);
    try {
      const result = await api(`organizations/${organizationId}/crm/contacts/${contact.id}/push`, pushOrganizationContactToEventResultSchema, { method: "POST", body: { eventId: pushEventId } });
      toast(result.alreadyLinked ? "Already linked to that event" : result.created ? "Pushed as a new speaker" : "Linked to the existing speaker record");
      await refresh();
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "That push failed");
    } finally {
      setPushBusy(false);
    }
  }

  const linkedEventIds = useMemo(() => new Set(history.events.map((event) => event.eventId)), [history.events]);
  const pushableEvents = events.filter((event) => !linkedEventIds.has(event.id as EventId));

  return (
    <main className="page">
      <PageHeader
        eyebrow="ORGANIZATION"
        title="Speaker CRM"
        description="One identity's complete cross-event record."
        actions={<Link href={`/organizations/${organizationId}/crm`} className="button button-secondary"><ArrowLeft size={15} /> Directory</Link>}
      />
      <CrmNav organizationId={organizationId} active="contact" />

      <div className="panel">
        <header className="panel-header crm-detail-hero">
          <Avatar initials={initialsFor(contact)} size="lg" />
          <div>
            <h1 style={{ margin: "0 0 4px" }}>{nameOf(contact)}</h1>
            <p style={{ margin: 0, color: "var(--muted)", fontSize: 11 }}>{contact.email}{contact.jobTitle ? ` · ${contact.jobTitle}` : ""}{contact.company ? ` at ${contact.company}` : ""}</p>
          </div>
          <StatusBadge value={contact.source} />
          <Button variant="secondary" size="sm" onClick={() => setMergeSearchOpen(true)}><GitMerge size={14} /> Merge with…</Button>
        </header>
      </div>

      <div className="drawer-tabs" style={{ marginTop: 18 }} role="tablist">
        <button type="button" role="tab" aria-selected={tab === "overview"} className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button>
        <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>History<span>{history.events.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "notes"} className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>Notes<span>{history.notes.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>Activity<span>{history.activity.length}</span></button>
      </div>

      <div className="drawer-content" style={{ padding: "20px 0" }}>
        {tab === "overview" && (
          <div className="crm-detail-layout">
            <section className="panel settings-section">
              <header className="panel-header"><h2>Details</h2></header>
              <div style={{ padding: "0 20px 20px" }} className="form-stack">
                <div className="form-grid">
                  <Field label="First name"><input value={fields.firstName} onChange={(event) => setFields((current) => ({ ...current, firstName: event.target.value }))} /></Field>
                  <Field label="Last name"><input value={fields.lastName} onChange={(event) => setFields((current) => ({ ...current, lastName: event.target.value }))} /></Field>
                  <Field label="Company"><input value={fields.company} onChange={(event) => setFields((current) => ({ ...current, company: event.target.value }))} /></Field>
                  <Field label="Job title"><input value={fields.jobTitle} onChange={(event) => setFields((current) => ({ ...current, jobTitle: event.target.value }))} /></Field>
                  <Field label="LinkedIn"><input value={fields.linkedinUrl} onChange={(event) => setFields((current) => ({ ...current, linkedinUrl: event.target.value }))} /></Field>
                  <Field label="Twitter/X"><input value={fields.twitterUrl} onChange={(event) => setFields((current) => ({ ...current, twitterUrl: event.target.value }))} /></Field>
                  <Field label="Website"><input value={fields.websiteUrl} onChange={(event) => setFields((current) => ({ ...current, websiteUrl: event.target.value }))} /></Field>
                </div>
                <div className="drawer-actions">
                  <Button disabled={!fieldsDirty || savingFields} onClick={() => void saveFields()}>{savingFields ? "Saving…" : "Save details"}</Button>
                </div>
                {contact.bioHtml && <div><h3 style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase" }}>Bio</h3><RichTextView html={contact.bioHtml} /></div>}
              </div>
            </section>

            <aside style={{ display: "grid", gap: 16, alignContent: "start" }}>
              <section className="panel settings-section">
                <header className="panel-header"><h2>Tags</h2></header>
                <div style={{ padding: "0 20px 20px" }} className="chip-picker">
                  {allTags.length === 0 && <p className="long-copy">No tags yet — create one from a note or the directory filters.</p>}
                  {allTags.map((tag) => {
                    const active = history.tags.some((row) => row.id === tag.id);
                    return (
                      <button key={tag.id} type="button" disabled={tagBusy} className={active ? "chip chip--selected" : "chip"} onClick={() => void toggleTag(tag.id)}>
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              </section>

              {customFields.length > 0 && (
                <section className="panel settings-section">
                  <header className="panel-header"><h2>Custom fields</h2></header>
                  <div style={{ padding: "0 20px 20px" }} className="form-stack">
                    {customFields.map((field) => (
                      <Field key={field.id} label={field.label}>
                        {field.fieldType === "select" ? (
                          <select value={customValues[field.key] ?? ""} onChange={(event) => setCustomValues((current) => ({ ...current, [field.key]: event.target.value }))}>
                            <option value="">—</option>
                            {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        ) : (
                          <input value={customValues[field.key] ?? ""} onChange={(event) => setCustomValues((current) => ({ ...current, [field.key]: event.target.value }))} />
                        )}
                      </Field>
                    ))}
                    <Button size="sm" disabled={!customDirty || savingCustom} onClick={() => void saveCustomFields()}>{savingCustom ? "Saving…" : "Save custom fields"}</Button>
                  </div>
                </section>
              )}

              <section className="panel settings-section">
                <header className="panel-header"><h2>Push to event</h2><p>Reuses this identity&rsquo;s speaker record for another event — never a duplicate.</p></header>
                <div style={{ padding: "0 20px 20px" }} className="form-stack">
                  {pushableEvents.length === 0 ? (
                    <p className="long-copy">Already linked to every event in this organization.</p>
                  ) : (
                    <>
                      <select value={pushEventId} onChange={(event) => setPushEventId(event.target.value)}>
                        {pushableEvents.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
                      </select>
                      <Button size="sm" disabled={pushBusy} onClick={() => void pushToEvent()}><Send size={14} /> {pushBusy ? "Pushing…" : "Push"}</Button>
                    </>
                  )}
                </div>
              </section>
            </aside>
          </div>
        )}

        {tab === "history" && (
          <section>
            {history.events.length === 0 && <p className="long-copy">Not linked to any event yet.</p>}
            {history.events.map((event) => (
              <div className="crm-event-card" key={event.eventId}>
                <header>
                  <div><b>{event.eventName}</b><small>Linked {new Date(event.linkedAt).toLocaleDateString()}</small></div>
                  <StatusBadge value={event.confirmationStatus} />
                </header>
                {event.sessions.length > 0 && (
                  <ul>
                    {event.sessions.map((session) => <li key={session.sessionId}><span>{session.title}</span><span>{session.status}</span></li>)}
                  </ul>
                )}
              </div>
            ))}
          </section>
        )}

        {tab === "notes" && (
          <section>
            <div className="form-stack" style={{ marginBottom: 18 }}>
              <Field label="Add a note">
                <textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} rows={3} />
              </Field>
              <div className="drawer-actions">
                <Button size="sm" disabled={!noteBody.trim() || noteBusy} onClick={() => void addNote()}><StickyNote size={14} /> {noteBusy ? "Saving…" : "Add note"}</Button>
              </div>
            </div>
            {history.notes.length === 0 && <p className="long-copy">No notes yet.</p>}
            {history.notes.map((note) => (
              <div className="crm-note" key={note.id}>
                <header><span>{note.authorName ?? "Someone"}</span><span>{new Date(note.createdAt).toLocaleString()}</span></header>
                <RichTextView html={note.bodyHtml} />
              </div>
            ))}
          </section>
        )}

        {tab === "activity" && (
          <section className="activity-list">
            {history.activity.length === 0 && <p className="long-copy">No activity recorded yet.</p>}
            {history.activity.map((entry) => {
              const metadata = entry.metadata as Record<string, unknown>;
              let detail: string | null = null;
              if (entry.kind === "field_changed" && Array.isArray(metadata.fields)) detail = `Fields: ${(metadata.fields as string[]).join(", ")}`;
              if (entry.kind === "pipeline_stage_changed" && typeof metadata.from === "string" && typeof metadata.to === "string") detail = `${metadata.from} → ${metadata.to}`;
              return (
                <div key={entry.id}>
                  <span />
                  <p><b>{ACTIVITY_LABEL[entry.kind] ?? entry.kind}</b><small>{new Date(entry.createdAt).toLocaleString()}{detail ? ` · ${detail}` : ""}</small></p>
                </div>
              );
            })}
          </section>
        )}
      </div>

      <MergeSearchDialog
        organizationId={organizationId}
        excludeId={contact.id}
        open={mergeSearchOpen}
        onClose={() => setMergeSearchOpen(false)}
        onPick={(row) => { setMergeWith(row); setMergeSearchOpen(false); }}
      />
      {mergeWith && (
        <MergeWizardDialog
          organizationId={organizationId}
          open
          a={{ id: contact.id, label: nameOf(contact), email: contact.email }}
          b={{ id: mergeWith.id, label: nameOf(mergeWith), email: mergeWith.email }}
          onClose={() => { setMergeWith(null); router.refresh(); }}
        />
      )}
    </main>
  );
}
