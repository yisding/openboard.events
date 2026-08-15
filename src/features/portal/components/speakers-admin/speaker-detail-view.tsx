"use client";

import { AlertTriangle, CheckCircle2, ExternalLink, Facebook, Globe, Linkedin, Pencil, Twitter } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { SpeakerDetailDTO, SpeakerRosterExtras } from "@/features/portal";
import { participantRoleLabel } from "../../lib/participant-role";
import { LIMITS, plainTextLength, type ConfirmationStatus, type TemplateKey } from "@/shared/contracts";
import { FileUpload } from "@/shared/ui/app/file-upload";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button, Field, PageHeader, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { SpeakerHeadshot } from "./speaker-headshot";
import { SpeakerRosterPanels } from "./speaker-roster-panels";
import { SpeakerStatusOptions } from "./speaker-status-options";

/** One map, beside the timeline it labels — never reimplemented per row. */
const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  submission_received: "Submission received",
  submission_accepted: "Submission accepted",
  submission_declined: "Submission declined",
  task_assigned: "Task assigned",
  task_reminder: "Task reminder",
  schedule_assigned: "Schedule assigned",
  schedule_changed: "Schedule changed",
  portal_login: "Portal sign-in",
  reviewer_invited: "Reviewer invited",
  review_reminder: "Review reminder",
  speaker_bulk_message: "Message",
  admin_password_reset: "Password reset",
  admin_email_verification: "Email verification",
  organization_invited: "Team invitation",
};

const CONFIRMATION_OPTIONS: ConfirmationStatus[] = ["unconfirmed", "confirmed", "declined"];

function initialsFor(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

async function patchSpeaker(eventId: string, contactId: string, body: Record<string, unknown>): Promise<SpeakerDetailDTO> {
  const response = await fetch(`/api/internal/speakers/${eventId}/${contactId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json() as { data?: SpeakerDetailDTO; error?: { message?: string } };
  if (!response.ok || !json.data) throw new Error(json.error?.message ?? "Could not save that change");
  return json.data;
}

/**
 * "Open portal as {name}" — real impersonation (M06b), not a demo-store id in
 * localStorage. The tab is opened synchronously (before the `fetch` resolves)
 * so a popup blocker never eats an async-triggered `window.open`; once the
 * impersonate endpoint's redirect target is known, the already-open tab is
 * pointed at it.
 */
function ImpersonateButton({ eventId, contactId, firstName }: { eventId: string; contactId: string; firstName: string }) {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  return (
    <Button
      disabled={pending}
      onClick={() => {
        setPending(true);
        const tab = window.open("", "_blank");
        fetch("/api/internal/auth/portal/impersonate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, contactId }),
        }).then((response) => {
          if (!response.ok || !tab) {
            tab?.close();
            toast("Could not start impersonation", { kind: "error" });
            return;
          }
          tab.location.href = response.url;
        }).catch(() => {
          tab?.close();
          toast("Could not start impersonation", { kind: "error" });
        }).finally(() => setPending(false));
      }}
    >
      <ExternalLink size={15} /> Open portal as {firstName || "speaker"}
    </Button>
  );
}

function EmailField({ eventId, contactId, email, onSaved }: { eventId: string; contactId: string; email: string; onSaved: (detail: SpeakerDetailDTO) => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(email);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!editing) {
    return (
      <div className="speaker-email-row">
        <span>{email}</span>
        <button type="button" className="icon-button" aria-label="Edit email" onClick={() => { setDraft(email); setError(null); setEditing(true); }}>
          <Pencil size={14} />
        </button>
      </div>
    );
  }
  return (
    <form
      className="speaker-email-row"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
          const detail = await patchSpeaker(eventId, contactId, { email: draft.trim() });
          onSaved(detail);
          setEditing(false);
          toast("Email updated");
        } catch (patchError) {
          setError(patchError instanceof Error ? patchError.message : "Could not save that change");
        } finally {
          setSaving(false);
        }
      }}
    >
      <input type="email" required value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Speaker email" autoFocus />
      <Button type="submit" size="sm" disabled={saving}>Save</Button>
      <button type="button" className="icon-button" aria-label="Cancel" onClick={() => setEditing(false)}>Cancel</button>
      {error && <span className="field-error">{error}</span>}
    </form>
  );
}

/**
 * M52 — organizer-uploaded headshot. Presigns as an admin upload (kind is
 * fixed and public regardless of who uploads it), finalizes, then patches
 * only `headshotFileId` — never touches bio/links in the same write.
 */
function HeadshotField({ eventId, contactId, headshotFileId, onSaved }: {
  eventId: string; contactId: string; headshotFileId: string | null; onSaved: (detail: SpeakerDetailDTO) => void;
}) {
  const { toast } = useToast();
  async function onUploaded(fileId: string) {
    try {
      const detail = await patchSpeaker(eventId, contactId, { headshotFileId: fileId });
      onSaved(detail);
      toast("Photo updated");
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save that photo", { kind: "error" });
      return false;
    }
  }
  return (
    <Field label="Headshot">
      <FileUpload eventId={eventId} kind="headshot" currentFileId={headshotFileId} onUploaded={(fileId) => onUploaded(fileId)} label="Upload new photo" />
    </Field>
  );
}

/** M52 — organizer-edited biography, sanitized server-side on save. */
function BioField({ eventId, contactId, bioHtml, onSaved }: {
  eventId: string; contactId: string; bioHtml: string | null; onSaved: (detail: SpeakerDetailDTO) => void;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(bioHtml ?? "");
  const [saving, setSaving] = useState(false);
  const bioLength = plainTextLength(draft);
  const overLimit = bioLength > LIMITS.BIO;

  if (!editing) {
    return (
      <div>
        {bioHtml ? <RichTextView html={bioHtml} /> : <p className="long-copy">No biography submitted yet.</p>}
        <button type="button" className="icon-button" aria-label="Edit biography" onClick={() => { setDraft(bioHtml ?? ""); setEditing(true); }}>
          <Pencil size={14} />
        </button>
      </div>
    );
  }
  return (
    <div>
      <RichTextEditor ariaLabel="Speaker biography" value={draft} onChange={setDraft} maxChars={LIMITS.BIO} placeholder="Tell attendees about this speaker…" />
      <div className="speaker-email-row" style={{ marginTop: 8 }}>
        <Button
          size="sm"
          disabled={saving || overLimit}
          onClick={async () => {
            setSaving(true);
            try {
              const detail = await patchSpeaker(eventId, contactId, { bioHtml: draft });
              onSaved(detail);
              setEditing(false);
              toast("Biography updated");
            } catch (error) {
              toast(error instanceof Error ? error.message : "Could not save that change", { kind: "error" });
            } finally {
              setSaving(false);
            }
          }}
        >
          Save
        </Button>
        <button type="button" className="icon-button" aria-label="Cancel" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </div>
  );
}

export function SpeakerDetailView({ eventId, timezone, initialDetail, initialExtras }: { eventId: string; timezone: string; initialDetail: SpeakerDetailDTO; initialExtras?: SpeakerRosterExtras }) {
  const { toast } = useToast();
  const [detail, setDetail] = useState(initialDetail);
  const [savingConfirmation, setSavingConfirmation] = useState(false);
  const { contact } = detail;

  async function applyConfirmation(status: ConfirmationStatus) {
    if (status === contact.confirmationStatus) return;
    setSavingConfirmation(true);
    try {
      const next = await patchSpeaker(eventId, contact.contactId, { confirmationStatus: status });
      setDetail(next);
      toast(status === "declined" ? "Confirmation set to declined — removed from the public gallery" : "Confirmation updated");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update confirmation", { kind: "error" });
    } finally {
      setSavingConfirmation(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="PEOPLE"
        title={contact.name}
        description={contact.jobTitle || contact.company ? `${contact.jobTitle ?? ""}${contact.jobTitle && contact.company ? " at " : ""}${contact.company ?? ""}` : "Speaker profile"}
        actions={<ImpersonateButton eventId={eventId} contactId={contact.contactId} firstName={contact.name.split(" ")[0] ?? ""} />}
      />

      {contact.unsubscribedAt && (
        <div className="notify-bar" style={{ borderColor: "var(--red-soft)", background: "var(--red-soft)" }}>
          <div><AlertTriangle size={18} /><p><b>Reminder emails suppressed</b><small>This speaker unsubscribed from event communications.</small></p></div>
        </div>
      )}

      <section className="panel">
        <header className="panel-header"><div><h2>Profile</h2><p>What this speaker has shared about themselves.</p></div></header>
        <div className="drawer-content">
          <div className="speaker-card" style={{ marginBottom: 16 }}>
            <SpeakerHeadshot
              name={contact.name}
              initials={initialsFor(contact.name, contact.email)}
              headshotFileId={contact.headshotFileId}
              size="lg"
            />
            <div className="speaker-card-copy">
              <b>{contact.name}</b>
              <span>{[contact.salutation, contact.pronouns, contact.gender].filter(Boolean).join(" · ") || "—"}</span>
            </div>
            <StatusBadge value={contact.confirmationStatus} />
          </div>
          {/* M52 — organizer-edited headshot, through the same presign/finalize
              flow (kind=headshot) the speaker's own profile page uses. */}
          <HeadshotField eventId={eventId} contactId={contact.contactId} headshotFileId={contact.headshotFileId} onSaved={setDetail} />
          <Field label="Email"><EmailField eventId={eventId} contactId={contact.contactId} email={contact.email} onSaved={setDetail} /></Field>
          <h3>Links</h3>
          <div className="chip-picker">
            {contact.links.linkedin && <a className="chip" href={contact.links.linkedin} target="_blank" rel="noopener noreferrer"><Linkedin size={12} /> LinkedIn</a>}
            {contact.links.twitter && <a className="chip" href={contact.links.twitter} target="_blank" rel="noopener noreferrer"><Twitter size={12} /> Twitter/X</a>}
            {contact.links.facebook && <a className="chip" href={contact.links.facebook} target="_blank" rel="noopener noreferrer"><Facebook size={12} /> Facebook</a>}
            {contact.links.website && <a className="chip" href={contact.links.website} target="_blank" rel="noopener noreferrer"><Globe size={12} /> Website</a>}
            {!contact.links.linkedin && !contact.links.twitter && !contact.links.facebook && !contact.links.website && <span className="dash">—</span>}
          </div>
          <h3>Biography</h3>
          <BioField eventId={eventId} contactId={contact.contactId} bioHtml={contact.bioHtml} onSaved={setDetail} />
        </div>
      </section>

      <section className="panel">
        <header className="panel-header"><div><h2>Confirmation</h2><p>Accepted speakers are confirmed automatically when you Notify; override here if they drop out.</p></div></header>
        <div className="drawer-content">
          <SpeakerStatusOptions
            label="Speaker confirmation status"
            options={CONFIRMATION_OPTIONS}
            value={contact.confirmationStatus}
            disabled={savingConfirmation}
            onChange={(status) => void applyConfirmation(status)}
          />
          {contact.confirmationStatus === "declined" && (
            <p className="long-copy">This speaker is hidden from the public speaker gallery while declined.</p>
          )}
        </div>
      </section>

      <section className="panel">
        <header className="panel-header"><div><h2>Submissions</h2><p>{detail.submissions.length} on this event.</p></div></header>
        <div className="drawer-content">
          {detail.submissions.length === 0 && <p className="long-copy">No submissions from this contact.</p>}
          {detail.submissions.map((submission) => (
            <Link key={submission.submissionId} className="mini-session" href={`/events/${eventId}/abstracts?submission=${submission.submissionId}`}>
              <span className="mini-session-meta">SESS-{submission.code}</span>
              <b>{submission.title}{submission.isPrimary ? "" : ` (${participantRoleLabel(submission.role)})`}</b>
              <StatusBadge value={submission.portalStatus} />
            </Link>
          ))}
        </div>
      </section>

      <section className="panel">
        <header className="panel-header"><div><h2>Tasks</h2><p>{detail.tasks.filter((task) => !task.completed).length} open of {detail.tasks.length}.</p></div></header>
        <div className="drawer-content">
          {detail.tasks.length === 0 && <p className="long-copy">No onboarding tasks assigned yet.</p>}
          {detail.tasks.map((task) => (
            <div className="mini-session" key={task.taskId}>
              <span className="mini-session-meta">{task.dueAt ? <TzTime instant={task.dueAt} tz={timezone} style="date" /> : "No due date"}</span>
              <b>{task.name}</b>
              <StatusBadge value={task.completed ? "complete" : task.overdue ? "overdue" : "open"} />
            </div>
          ))}
        </div>
      </section>

      {initialExtras && <SpeakerRosterPanels eventId={eventId} contactId={contact.contactId} timezone={timezone} initialExtras={initialExtras} />}

      <section className="panel">
        <header className="panel-header"><div><h2>Communications</h2><p>Every message sent to this speaker.</p></div></header>
        <div className="activity-list" style={{ padding: "0 24px 24px" }}>
          {detail.comms.length === 0 && <p className="long-copy">No messages sent yet.</p>}
          {detail.comms.map((log) => (
            <div key={log.id}>
              <span />
              <p>
                <b>{TEMPLATE_LABELS[log.templateKey]}{log.subjectRendered ? ` — ${log.subjectRendered}` : ""}</b>
                <small>
                  {log.sentAt ? <TzTime instant={log.sentAt} tz={timezone} style="dateTime" /> : <TzTime instant={log.createdAt} tz={timezone} style="dateTime" />}
                  {" · "}<StatusBadge value={log.status} />
                  {log.status === "sent" && <> <CheckCircle2 size={11} /></>}
                </small>
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
