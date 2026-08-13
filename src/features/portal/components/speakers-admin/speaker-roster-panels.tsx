"use client";

import { FileText, Mail, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SpeakerRosterExtras } from "@/features/portal";
import { SPEAKER_WORKFLOW_STATUSES, type SpeakerWorkflowStatus, type UnavailabilityIntervalInput } from "@/shared/contracts";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { PrivateFileLink } from "@/shared/ui/app/private-file-link";
import { TzTime } from "@/shared/ui/app/tz-time";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Field, Select } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { SpeakerStatusOptions } from "./speaker-status-options";

/**
 * A window mid-edit. `DateTimePicker` reads and writes UTC instants in the
 * event's zone, so the draft holds instants too — there is no naive wall-clock
 * string anywhere between the roster and the contract. A side is null until the
 * organizer fills it. Validation keeps incomplete rows in place rather than
 * silently omitting them from the full-set replacement.
 */
export type UnavailabilityDraftRow = { startsAt: string | null; endsAt: string | null; reason?: string };
export type UnavailabilityDraftErrors = Array<{ startsAt?: string; endsAt?: string; reason?: string }>;

export function unavailabilityDraftFrom(extras: SpeakerRosterExtras): UnavailabilityDraftRow[] {
  return extras.unavailability.map((row) => ({
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    ...(row.reason ? { reason: row.reason } : {}),
  }));
}

export function isUnavailabilityDraftDirty(draft: UnavailabilityDraftRow[], baseline: UnavailabilityDraftRow[]): boolean {
  const comparable = (rows: UnavailabilityDraftRow[]) => rows.map((row) => ({
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    reason: row.reason?.trim() ?? "",
  }));
  return JSON.stringify(comparable(draft)) !== JSON.stringify(comparable(baseline));
}

export function validateUnavailabilityDraft(draft: UnavailabilityDraftRow[]): {
  errors: UnavailabilityDraftErrors;
  intervals: UnavailabilityIntervalInput[] | null;
} {
  const errors: UnavailabilityDraftErrors = [];
  const intervals: UnavailabilityIntervalInput[] = [];
  draft.forEach((row) => {
    const rowErrors: UnavailabilityDraftErrors[number] = {};
    if (!row.startsAt) rowErrors.startsAt = "Choose a start time";
    if (!row.endsAt) rowErrors.endsAt = "Choose an end time";
    if (row.startsAt && row.endsAt && Date.parse(row.endsAt) <= Date.parse(row.startsAt)) {
      rowErrors.endsAt = "End must be after start";
    }
    if ((row.reason?.trim().length ?? 0) > 200) rowErrors.reason = "Reason must be 200 characters or fewer";
    errors.push(rowErrors);
    if (Object.keys(rowErrors).length === 0 && row.startsAt && row.endsAt) {
      intervals.push({
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        ...(row.reason?.trim() ? { reason: row.reason.trim() } : {}),
      });
    }
  });
  return { errors, intervals: errors.some((row) => Object.keys(row).length > 0) ? null : intervals };
}

export function logisticsValuesFrom(extras: SpeakerRosterExtras): Record<string, string> {
  const values = Object.fromEntries(extras.fields.map((field) => [field.id, ""]));
  for (const entry of extras.values) values[entry.fieldId] = entry.value;
  return values;
}

export function mergeIncomingLogisticsValues(
  current: Record<string, string>,
  baseline: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(Object.keys(incoming).map((fieldId) => [
    fieldId,
    current[fieldId] !== undefined && current[fieldId] !== (baseline[fieldId] ?? "")
      ? current[fieldId]
      : incoming[fieldId] ?? "",
  ]));
}

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
        <SpeakerStatusOptions
          label="Speaker pipeline status"
          options={SPEAKER_WORKFLOW_STATUSES}
          value={workflowStatus}
          disabled={saving}
          onChange={(status) => void apply(status)}
        />
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
    <div className="speaker-logistics-field-form">
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
  const incomingValues = useMemo(() => logisticsValuesFrom(extras), [extras]);
  const [values, setValues] = useState<Record<string, string>>(incomingValues);
  const [baseline, setBaseline] = useState<Record<string, string>>(incomingValues);
  const baselineRef = useRef(incomingValues);
  const [savingFields, setSavingFields] = useState<Set<string>>(() => new Set());
  const [savedField, setSavedField] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const dirty = extras.fields.some((field) => (values[field.id] ?? "") !== (baseline[field.id] ?? ""));
  useUnsavedWorkGuard(dirty);

  useEffect(() => {
    setValues((current) => mergeIncomingLogisticsValues(current, baselineRef.current, incomingValues));
    baselineRef.current = incomingValues;
    setBaseline(incomingValues);
  }, [incomingValues]);

  async function save(fieldId: string, value: string) {
    if (savingFields.has(fieldId)) return;
    const previous = baselineRef.current[fieldId] ?? "";
    setSavingFields((current) => new Set(current).add(fieldId));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    try {
      const nextExtras = await patchRoster(eventId, contactId, { logisticsValues: { [fieldId]: value } });
      const nextBaseline = logisticsValuesFrom(nextExtras);
      setValues((current) => mergeIncomingLogisticsValues(current, baselineRef.current, nextBaseline));
      baselineRef.current = nextBaseline;
      setBaseline(nextBaseline);
      setSavedField(fieldId);
      onSaved(nextExtras);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save that field";
      setValues((current) => ({ ...current, [fieldId]: previous }));
      setFieldErrors((current) => ({ ...current, [fieldId]: message }));
      toast(`${message}. The previous value was restored.`);
    } finally {
      setSavingFields((current) => {
        const next = new Set(current);
        next.delete(fieldId);
        return next;
      });
    }
  }

  function change(fieldId: string, value: string) {
    setValues((current) => ({ ...current, [fieldId]: value }));
    setSavedField((current) => current === fieldId ? null : current);
    setFieldErrors((current) => {
      if (!current[fieldId]) return current;
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  }

  return (
    <section className="panel">
      <header className="panel-header speaker-logistics-header">
        <div><h2>Logistics</h2><p>Organizer-defined fields shared by every speaker on this event.</p></div>
        <AddLogisticsFieldRow eventId={eventId} onCreated={() => router.refresh()} />
      </header>
      <div className="drawer-content form-stack">
        {extras.fields.length === 0 && <p className="long-copy">No event-scoped logistics fields defined yet.</p>}
        {extras.fields.map((field) => {
          const current = values[field.id] ?? "";
          const saving = savingFields.has(field.id);
          return (
            <Field
              key={field.id}
              label={field.label}
              error={fieldErrors[field.id]}
              errorId={`logistics-${field.id}-error`}
              {...(saving ? { hint: "Saving…" } : savedField === field.id ? { hint: "Saved" } : {})}
            >
              {field.fieldType === "select" ? (
                <Select
                  value={current}
                  disabled={saving}
                  aria-invalid={Boolean(fieldErrors[field.id]) || undefined}
                  aria-describedby={fieldErrors[field.id] ? `logistics-${field.id}-error` : undefined}
                  onChange={(event) => change(field.id, event.target.value)}
                  onBlur={(event) => { if (event.target.value !== (baseline[field.id] ?? "")) void save(field.id, event.target.value); }}
                >
                  <option value="">—</option>
                  {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                </Select>
              ) : (
                <input
                  value={current}
                  disabled={saving}
                  aria-invalid={Boolean(fieldErrors[field.id]) || undefined}
                  aria-describedby={fieldErrors[field.id] ? `logistics-${field.id}-error` : undefined}
                  onChange={(event) => change(field.id, event.target.value)}
                  onBlur={(event) => { if (event.target.value !== (baseline[field.id] ?? "")) void save(field.id, event.target.value); }}
                />
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
  const sectionRef = useRef<HTMLElement>(null);
  const [saving, setSaving] = useState(false);
  const incomingDraft = useMemo(() => unavailabilityDraftFrom(extras), [extras]);
  const incomingDraftKey = JSON.stringify(incomingDraft);
  const previousIncomingDraftKey = useRef(incomingDraftKey);
  const [draft, setDraft] = useState<UnavailabilityDraftRow[]>(incomingDraft);
  const [baseline, setBaseline] = useState<UnavailabilityDraftRow[]>(incomingDraft);
  const [fieldErrors, setFieldErrors] = useState<UnavailabilityDraftErrors>([]);
  const dirty = isUnavailabilityDraftDirty(draft, baseline);
  useUnsavedWorkGuard(dirty);

  useEffect(() => {
    if (incomingDraftKey === previousIncomingDraftKey.current) return;
    if (!isUnavailabilityDraftDirty(draft, baseline)) {
      previousIncomingDraftKey.current = incomingDraftKey;
      setDraft(incomingDraft);
      setBaseline(incomingDraft);
    } else if (!isUnavailabilityDraftDirty(incomingDraft, baseline)) {
      previousIncomingDraftKey.current = incomingDraftKey;
      setBaseline(incomingDraft);
    }
  }, [baseline, draft, incomingDraft, incomingDraftKey]);

  function updateRow(index: number, patch: Partial<UnavailabilityDraftRow>) {
    setDraft((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
    setFieldErrors((current) => current.map((row, rowIndex) => rowIndex === index ? {} : row));
  }

  async function save() {
    const validation = validateUnavailabilityDraft(draft);
    if (!validation.intervals) {
      setFieldErrors(validation.errors);
      window.requestAnimationFrame(() => sectionRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      toast("Complete each availability window before saving");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/internal/speakers/${eventId}/${contactId}/unavailability`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intervals: validation.intervals }),
      });
      const json = await response.json() as { data?: { intervals: SpeakerRosterExtras["unavailability"] }; error?: { message?: string } };
      if (!response.ok || !json.data) throw new Error(json.error?.message ?? "Could not save availability");
      onSaved({ ...extras, unavailability: json.data.intervals });
      const saved = json.data.intervals.map((row) => ({ startsAt: row.startsAt, endsAt: row.endsAt, ...(row.reason ? { reason: row.reason } : {}) }));
      setDraft(saved);
      setBaseline(saved);
      setFieldErrors([]);
      toast("Availability updated");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save availability");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section ref={sectionRef} className="panel">
      <header className="panel-header">
        <div><h2>Unavailability</h2><p>Blackout windows in {timezone}, applied by M54 when placing this speaker on the schedule.</p></div>
        <Button size="sm" variant="secondary" disabled={draft.length >= 50} onClick={() => { setDraft((current) => [...current, { startsAt: null, endsAt: null, reason: "" }]); setFieldErrors((current) => [...current, {}]); }}><Plus size={14} /> Add window</Button>
      </header>
      <div className="drawer-content form-stack">
        {draft.length === 0 && <p className="long-copy">No declared blackout — this speaker is treated as available for the whole event.</p>}
        {draft.map((row, index) => (
          <div key={index} className="speaker-unavailability-form">
            <Field label="Starts" error={fieldErrors[index]?.startsAt} errorId={`unavailability-${index}-start-error`}>
              <DateTimePicker value={row.startsAt} onChange={(startsAt) => updateRow(index, { startsAt })} tz={timezone} invalid={Boolean(fieldErrors[index]?.startsAt)} {...(fieldErrors[index]?.startsAt ? { ariaDescribedBy: `unavailability-${index}-start-error` } : {})} />
            </Field>
            <Field label="Ends" error={fieldErrors[index]?.endsAt} errorId={`unavailability-${index}-end-error`}>
              <DateTimePicker value={row.endsAt} onChange={(endsAt) => updateRow(index, { endsAt })} tz={timezone} invalid={Boolean(fieldErrors[index]?.endsAt)} {...(fieldErrors[index]?.endsAt ? { ariaDescribedBy: `unavailability-${index}-end-error` } : {})} />
            </Field>
            <Field label="Reason (optional)" error={fieldErrors[index]?.reason} errorId={`unavailability-${index}-reason-error`}>
              <input value={row.reason ?? ""} aria-invalid={Boolean(fieldErrors[index]?.reason) || undefined} aria-describedby={fieldErrors[index]?.reason ? `unavailability-${index}-reason-error` : undefined} onChange={(event) => updateRow(index, { reason: event.target.value })} placeholder="Flight, other commitment…" />
            </Field>
            <button type="button" className="icon-button" aria-label="Remove window" onClick={() => { setDraft((current) => current.filter((_row, rowIndex) => rowIndex !== index)); setFieldErrors((current) => current.filter((_row, rowIndex) => rowIndex !== index)); }}><Trash2 size={15} /></button>
          </div>
        ))}
        <div><Button size="sm" disabled={saving || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save availability"}</Button></div>
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
            <span className="mini-session-meta"><FileText size={14} /></span>
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
