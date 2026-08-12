"use client";

import { FileText, Mail, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { SpeakerRosterExtras } from "@/features/portal";
import { SPEAKER_WORKFLOW_STATUSES, type SpeakerWorkflowStatus } from "@/shared/contracts";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { PrivateFileLink } from "@/shared/ui/app/private-file-link";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button, Field, Select } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

/**
 * A window mid-edit. `DateTimePicker` reads and writes UTC instants in the
 * event's zone, so the draft holds instants too — there is no naive wall-clock
 * string anywhere between the roster and the contract. A side is null until the
 * organizer fills it, and a half-filled row is dropped on save.
 */
type UnavailabilityDraftRow = { startsAt: string | null; endsAt: string | null; reason?: string };

function bytesLabel(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function patchRoster(eventId: string, contactId: string, body: Record<string, unknown>): Promise<SpeakerRosterExtras> {
  const response = await fetch(`/api/internal/speakers/${eventId}/${contactId}/roster`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json() as { data?: SpeakerRosterExtras; error?: { message?: string } };
  if (!response.ok || !json.data) throw new Error(json.error?.message ?? "Could not save that change");
  return json.data;
}

/** Invite through M06b's exact login-challenge path (work order step 4). */
function InviteButton({ eventId, contactId }: { eventId: string; contactId: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const response = await fetch(`/api/internal/speakers/${eventId}/${contactId}/invite`, { method: "POST" });
          const json = await response.json() as { data?: { message?: string }; error?: { message?: string } };
          if (!response.ok) throw new Error(json.error?.message ?? "Could not send that invitation");
          toast(json.data?.message ?? "Invitation sent");
        } catch (error) {
          toast(error instanceof Error ? error.message : "Could not send that invitation");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Mail size={15} /> {busy ? "Sending…" : "Invite to portal"}
    </Button>
  );
}

function WorkflowStatusPanel({ eventId, contactId, workflowStatus, onSaved }: {
  eventId: string; contactId: string; workflowStatus: SpeakerWorkflowStatus; onSaved: (extras: SpeakerRosterExtras) => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  async function apply(status: SpeakerWorkflowStatus) {
    if (status === workflowStatus) return;
    setSaving(true);
    try {
      onSaved(await patchRoster(eventId, contactId, { workflowStatus: status }));
      toast("Pipeline status updated");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not update pipeline status");
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="panel">
      <header className="panel-header"><div><h2>Pipeline status</h2><p>Organizer-only bookkeeping — never affects publication or notifications.</p></div><InviteButton eventId={eventId} contactId={contactId} /></header>
      <div className="drawer-content">
        <div className="confirmation-options">
          {SPEAKER_WORKFLOW_STATUSES.map((status) => (
            <button key={status} type="button" disabled={saving} className={workflowStatus === status ? "active" : ""} onClick={() => void apply(status)}>{status}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

function AddLogisticsFieldRow({ eventId, onCreated }: { eventId: string; onCreated: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<"text" | "select">("text");
  const [options, setOptions] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}><Plus size={14} /> Add field</Button>;

  async function create() {
    setSaving(true);
    try {
      const response = await fetch(`/api/internal/speakers/${eventId}/logistics-fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: key.trim(),
          label: label.trim(),
          fieldType,
          options: fieldType === "select" ? options.split(",").map((option) => option.trim()).filter(Boolean) : [],
        }),
      });
      const json = await response.json() as { error?: { message?: string } };
      if (!response.ok) throw new Error(json.error?.message ?? "Could not create that field");
      setOpen(false); setKey(""); setLabel(""); setOptions(""); setFieldType("text");
      onCreated();
      toast("Field added");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not create that field");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr auto" }}>
      <Field label="Key" hint="lowercase_with_underscores"><input value={key} onChange={(event) => setKey(event.target.value)} /></Field>
      <Field label="Label"><input value={label} onChange={(event) => setLabel(event.target.value)} /></Field>
      <Field label="Type">
        <Select value={fieldType} onChange={(event) => setFieldType(event.target.value as "text" | "select")}>
          <option value="text">Text</option>
          <option value="select">Select</option>
        </Select>
      </Field>
      <Field label="Options" hint="comma separated, if select"><input value={options} onChange={(event) => setOptions(event.target.value)} disabled={fieldType !== "select"} /></Field>
      <Button size="sm" disabled={saving || !key.trim() || !label.trim()} onClick={() => void create()}>{saving ? "Adding…" : "Add"}</Button>
    </div>
  );
}

function LogisticsPanel({ eventId, contactId, extras, onSaved }: { eventId: string; contactId: string; extras: SpeakerRosterExtras; onSaved: (extras: SpeakerRosterExtras) => void }) {
  const { toast } = useToast();
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const valueByField = new Map(extras.values.map((value) => [value.fieldId, value.value]));

  async function save(fieldId: string, value: string) {
    setSaving(fieldId);
    try {
      onSaved(await patchRoster(eventId, contactId, { logisticsValues: { [fieldId]: value } }));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save that field");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <div><h2>Logistics</h2><p>Organizer-defined fields shared by every speaker on this event.</p></div>
        <AddLogisticsFieldRow eventId={eventId} onCreated={() => router.refresh()} />
      </header>
      <div className="drawer-content form-stack">
        {extras.fields.length === 0 && <p className="long-copy">No event-scoped logistics fields defined yet.</p>}
        {extras.fields.map((field) => {
          const current = valueByField.get(field.id) ?? "";
          return (
            <Field key={field.id} label={field.label}>
              {field.fieldType === "select" ? (
                <Select defaultValue={current} onBlur={(event) => { if (event.target.value !== current) void save(field.id, event.target.value); }}>
                  <option value="">—</option>
                  {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </Select>
              ) : (
                <input defaultValue={current} disabled={saving === field.id} onBlur={(event) => { if (event.target.value !== current) void save(field.id, event.target.value); }} />
              )}
            </Field>
          );
        })}
      </div>
    </section>
  );
}

function UnavailabilityPanel({ eventId, contactId, timezone, extras, onSaved }: {
  eventId: string; contactId: string; timezone: string; extras: SpeakerRosterExtras; onSaved: (extras: SpeakerRosterExtras) => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<UnavailabilityDraftRow[]>(
    extras.unavailability.map((row) => ({
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      ...(row.reason ? { reason: row.reason } : {}),
    })),
  );

  function updateRow(index: number, patch: Partial<UnavailabilityDraftRow>) {
    setDraft((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  async function save() {
    setSaving(true);
    try {
      // flatMap rather than filter+map: it narrows both sides to non-null, so
      // the instants reach the contract without a cast.
      const intervals = draft.flatMap((row) => row.startsAt && row.endsAt
        ? [{ startsAt: row.startsAt, endsAt: row.endsAt, ...(row.reason?.trim() ? { reason: row.reason.trim() } : {}) }]
        : []);
      const response = await fetch(`/api/internal/speakers/${eventId}/${contactId}/unavailability`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervals }),
      });
      const json = await response.json() as { data?: { intervals: SpeakerRosterExtras["unavailability"] }; error?: { message?: string } };
      if (!response.ok || !json.data) throw new Error(json.error?.message ?? "Could not save availability");
      onSaved({ ...extras, unavailability: json.data.intervals });
      setDraft(json.data.intervals.map((row) => ({
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        ...(row.reason ? { reason: row.reason } : {}),
      })));
      toast("Availability updated");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save availability");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <div><h2>Unavailability</h2><p>Blackout windows in {timezone}, applied by M54 when placing this speaker on the schedule.</p></div>
        <Button size="sm" variant="secondary" onClick={() => setDraft((current) => [...current, { startsAt: null, endsAt: null, reason: "" }])}><Plus size={14} /> Add window</Button>
      </header>
      <div className="drawer-content form-stack">
        {draft.length === 0 && <p className="long-copy">No declared blackout — this speaker is treated as available for the whole event.</p>}
        {draft.map((row, index) => (
          <div key={index} className="form-grid" style={{ alignItems: "end", gridTemplateColumns: "1fr 1fr 1fr auto" }}>
            <Field label="Starts"><DateTimePicker value={row.startsAt} onChange={(startsAt) => updateRow(index, { startsAt })} tz={timezone} /></Field>
            <Field label="Ends"><DateTimePicker value={row.endsAt} onChange={(endsAt) => updateRow(index, { endsAt })} tz={timezone} /></Field>
            <Field label="Reason (optional)"><input value={row.reason ?? ""} onChange={(event) => updateRow(index, { reason: event.target.value })} placeholder="Flight, other commitment…" /></Field>
            <button type="button" className="icon-button" aria-label="Remove window" onClick={() => setDraft((current) => current.filter((_row, rowIndex) => rowIndex !== index))}><Trash2 size={15} /></button>
          </div>
        ))}
        <div><Button size="sm" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save availability"}</Button></div>
      </div>
    </section>
  );
}

function UploadsPanel({ uploads, timezone }: { uploads: SpeakerRosterExtras["uploads"]; timezone: string }) {
  return (
    <section className="panel">
      <header className="panel-header"><div><h2>Uploaded files</h2><p>Every file this speaker has submitted through an onboarding task.</p></div></header>
      <div className="drawer-content">
        {uploads.length === 0 && <p className="long-copy">No files uploaded yet.</p>}
        {uploads.map((upload) => (
          <div className="mini-session" key={upload.fileId}>
            <span><FileText size={14} /></span>
            <b>{upload.filename}</b>
            <small>{upload.requestTitle} · {bytesLabel(upload.sizeBytes)} · <TzTime instant={upload.createdAt} tz={timezone} style="date" /> · {upload.uploaderLabel}</small>
            <PrivateFileLink fileId={upload.fileId}>Download</PrivateFileLink>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * M51 — the roster-specific panels a speaker's detail page adds beyond M27's
 * base profile/submissions/tasks/comms: pipeline status + invite, event-scoped
 * logistics fields, declared unavailability (the M54 read contract, edited
 * here through one full-set replace), and organizer-visible uploaded assets.
 */
export function SpeakerRosterPanels({ eventId, contactId, timezone, initialExtras }: {
  eventId: string; contactId: string; timezone: string; initialExtras: SpeakerRosterExtras;
}) {
  const router = useRouter();
  const [extras, setExtras] = useState(initialExtras);
  // `router.refresh()` (e.g. after adding a logistics field, which has no
  // response payload of its own) re-fetches `initialExtras` on the server and
  // hands it back down as a new prop; this client component's own state must
  // resync to it, since `useState`'s initializer only runs on first mount.
  useEffect(() => setExtras(initialExtras), [initialExtras]);
  function onSaved(next: SpeakerRosterExtras) {
    setExtras(next);
    router.refresh();
  }
  return (
    <>
      <WorkflowStatusPanel eventId={eventId} contactId={contactId} workflowStatus={extras.workflowStatus} onSaved={onSaved} />
      <LogisticsPanel eventId={eventId} contactId={contactId} extras={extras} onSaved={onSaved} />
      <UnavailabilityPanel eventId={eventId} contactId={contactId} timezone={timezone} extras={extras} onSaved={onSaved} />
      <UploadsPanel uploads={extras.uploads} timezone={timezone} />
    </>
  );
}

