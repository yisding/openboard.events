"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bell,
  Check,
  CircleCheck,
  Copy,
  Eye,
  FileText,
  LockKeyhole,
  MessageSquareText,
  Plus,
  Rocket,
  Save,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { FieldType, MapsToTarget, VisibilityRule } from "@/shared/contracts";
import { COMMITTED_FIELD_TYPES, CONDITION_OPS, MAPS_TO_TARGETS } from "@/shared/contracts";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { Button, Field, Modal, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { eventDayKey, hourMinuteInZone, zonedInputToUtc } from "@/shared/lib/time";
import { BUILDER_STEPS, type BuilderEvent, type BuilderField, type BuilderForm, type BuilderSection, type BuilderStep, type FormPatch } from "./builder-types";
import { mergeUnsavedBuilderEdits, type BuilderDirtyTarget } from "./form-builder-state";

const stepMeta = [
  { id: "setup", label: "Setup", icon: Settings2 },
  { id: "welcome", label: "Welcome", icon: MessageSquareText },
  { id: "abstract", label: "Abstract", icon: FileText },
  { id: "participant", label: "Participant", icon: Users },
  { id: "settings", label: "Settings", icon: SlidersHorizontal },
  { id: "notifications", label: "Notifications", icon: Bell },
] as const;

const addableTypes: Array<{ type: (typeof COMMITTED_FIELD_TYPES)[number]; label: string; description: string }> = [
  { type: "text", label: "Short text", description: "A single line response" },
  { type: "textarea", label: "Long text", description: "A paragraph response" },
  { type: "richtext", label: "Rich text", description: "Formatted long-form answer" },
  { type: "dropdown", label: "Dropdown", description: "Choose one option" },
  { type: "multiselect", label: "Multi-select", description: "Choose several options" },
  { type: "email", label: "Email", description: "Validated email address" },
  { type: "url", label: "Website", description: "Validated web address" },
  { type: "file", label: "File upload", description: "PDF, slides, or document" },
];

async function requestData<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = await response.json() as { data?: T; error?: { message?: string } };
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message ?? "The form could not be saved");
  return payload.data;
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function localInputValue(value: string | null, timezone: string): string {
  if (!value) return "";
  const { hour, minute } = hourMinuteInZone(value, timezone);
  return `${eventDayKey(value, timezone)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function FormBuilder({ event, initialForm }: { event: BuilderEvent; initialForm: BuilderForm }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const requestedStep = searchParams.get("step");
  const step: BuilderStep = BUILDER_STEPS.includes(requestedStep as BuilderStep) ? requestedStep as BuilderStep : "abstract";
  const [form, setForm] = useState(initialForm);
  const [selected, setSelected] = useState<{ sectionId: string; fieldId: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<(typeof COMMITTED_FIELD_TYPES)[number]>("text");
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRevisions = useRef(new Map<BuilderDirtyTarget, number>());
  const selectedField = useMemo(() => form.sections.flatMap((section) => section.fields).find((field) => field.id === selected?.fieldId) ?? null, [form.sections, selected]);

  function markDirty(target: BuilderDirtyTarget) {
    dirtyRevisions.current.set(target, (dirtyRevisions.current.get(target) ?? 0) + 1);
    setDirty(true);
  }

  function setStep(next: BuilderStep) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("step", next);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
    setSelected(null);
  }

  function applyLocal(patch: FormPatch) {
    setForm((current) => ({ ...current, ...patch }) as BuilderForm);
    markDirty(`step:${step}`);
  }

  function applySection(sectionId: string, patch: Partial<BuilderSection>) {
    setForm((current) => ({ ...current, sections: current.sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section) }));
    markDirty(`section:${sectionId}`);
  }

  function applyField(fieldId: string, patch: Partial<BuilderField>) {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section) => ({ ...section, fields: section.fields.map((field) => field.id === fieldId ? { ...field, ...patch } : field) })),
    }));
    markDirty(`field:${fieldId}`);
  }

  async function run(action: () => Promise<BuilderForm>, success: string, savedTargets: BuilderDirtyTarget[] = []) {
    if (busy) return;
    const savedRevisions = new Map(savedTargets.map((target) => [target, dirtyRevisions.current.get(target)]));
    setBusy(true);
    try {
      const next = await action();
      for (const [target, revision] of savedRevisions) {
        if (dirtyRevisions.current.get(target) === revision) dirtyRevisions.current.delete(target);
      }
      const remaining = new Set(dirtyRevisions.current.keys());
      setForm((current) => mergeUnsavedBuilderEdits(next, current, remaining));
      setDirty(remaining.size > 0);
      toast(success);
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "The form could not be saved");
    } finally {
      setBusy(false);
    }
  }

  function patchForm(patch: FormPatch, source = form): Promise<BuilderForm> {
    return requestData(`/api/internal/forms/${form.id}?eventId=${event.id}`, json("PATCH", { expectedUpdatedAt: source.updatedAt, patch }));
  }

  async function saveStep() {
    if (step === "abstract" || step === "participant") {
      const section = form.sections.find((candidate) => candidate.key === step);
      if (!section) return;
      await run(async () => {
        let current = form;
        if (step === "participant") current = await patchForm({ participantRoles: form.participantRoles }, current);
        return requestData(`/api/internal/forms/${form.id}/sections/${section.id}?eventId=${event.id}`, json("PATCH", {
          expectedUpdatedAt: current.updatedAt,
          patch: { title: section.title, pageHeading: section.pageHeading, descriptionHtml: section.descriptionHtml },
        }));
      }, `${step === "abstract" ? "Abstract" : "Participant"} step saved`, [
        `section:${section.id}`,
        ...(step === "participant" ? [`step:participant` as const] : []),
      ]);
      return;
    }
    const patch: FormPatch = step === "setup" ? {
      internalName: form.internalName,
      kind: form.kind,
      collectParticipants: form.collectParticipants,
    } : step === "welcome" ? {
      internalName: form.internalName,
      externalTitle: form.externalTitle,
      pageHeading: form.pageHeading,
      showWelcome: form.showWelcome,
      welcomeHtml: form.welcomeHtml,
    } : step === "settings" ? {
      status: form.status,
      opensAt: form.opensAt,
      closesAt: form.closesAt,
      submissionLimit: form.submissionLimit,
      successHtml: form.successHtml,
      autoRedirectToPortal: form.autoRedirectToPortal,
    } : {
      sendConfirmation: form.sendConfirmation,
      confirmationSubject: form.confirmationSubject,
      confirmationBodyHtml: form.confirmationBodyHtml,
    };
    await run(() => patchForm(patch), `${stepMeta.find((item) => item.id === step)?.label} step saved`, [`step:${step}`]);
  }

  async function saveField(field: BuilderField) {
    const structural = form.hasNonDraftSubmissions || field.locked ? {} : {
      key: field.key,
      fieldType: field.fieldType,
      required: field.required,
      optionLabels: field.options.map((option) => option.label),
      visibility: field.visibility,
      mapsTo: field.mapsTo,
    };
    await run(() => requestData(`/api/internal/forms/${form.id}/fields/${field.id}?eventId=${event.id}`, json("PATCH", {
      expectedUpdatedAt: form.updatedAt,
      patch: { label: field.label, helpText: field.helpText, maxChars: field.maxChars, ...structural },
    })), "Question saved", [`field:${field.id}`]);
  }

  async function addField() {
    const section = form.sections.find((candidate) => candidate.key === (step === "participant" ? "participant" : "abstract"));
    if (!section || !newLabel.trim()) return;
    await run(() => requestData(`/api/internal/forms/${form.id}/fields?eventId=${event.id}`, json("POST", {
      expectedUpdatedAt: form.updatedAt,
      sectionId: section.id,
      label: newLabel,
      fieldType: newType,
    })), "Question added");
    setAdding(false);
    setNewLabel("");
  }

  async function deleteField(field: BuilderField) {
    await run(() => requestData(`/api/internal/forms/${form.id}/fields/${field.id}?eventId=${event.id}`, json("DELETE", { expectedUpdatedAt: form.updatedAt })), "Question removed", [`field:${field.id}`]);
    setSelected(null);
  }

  async function moveField(section: BuilderSection, fieldId: string, delta: -1 | 1) {
    const current = section.fields.findIndex((field) => field.id === fieldId);
    const target = current + delta;
    if (current < 0 || target < 0 || target >= section.fields.length) return;
    const ordered = section.fields.map((field) => field.id);
    const currentId = ordered[current];
    const targetId = ordered[target];
    if (!currentId || !targetId) return;
    ordered[current] = targetId;
    ordered[target] = currentId;
    await run(() => requestData(`/api/internal/forms/${form.id}/fields/reorder?eventId=${event.id}`, json("POST", {
      expectedUpdatedAt: form.updatedAt,
      sectionId: section.id,
      orderedFieldIds: ordered,
    })), "Question order saved");
  }

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/submit/${event.slug}/${form.id}`);
    toast("Public form link copied");
  }

  const section = form.sections.find((candidate) => candidate.key === (step === "participant" ? "participant" : "abstract"));
  return <div className="builder-wrap">
    <header className="builder-header"><div className="builder-title"><Link className="icon-button" href={`/events/${event.id}/forms`}><ArrowLeft size={18} /></Link><div><div><h1>{form.internalName}</h1><StatusBadge value={form.status} /></div><span>Version {form.currentVersion} · <i className={dirty ? "saving" : "saved"}>{dirty ? "Unsaved changes" : "All changes saved"}</i></span></div></div><div className="builder-actions">
      <button className="button button-secondary" onClick={() => void copyLink()}><Copy size={16} /> Copy link</button>
      <Link className="button button-secondary" target="_blank" href={`/submit/${event.slug}/${form.id}`}><Eye size={16} /> View form</Link>
      <Button disabled={busy} onClick={() => void (selectedField ? saveField(selectedField) : saveStep())}><Save size={16} /> {busy ? "Saving…" : "Save"}</Button>
      <Button variant={form.status === "open" ? "secondary" : "primary"} disabled={busy} onClick={() => void run(() => patchForm({ status: form.status === "open" ? "closed" : "open" }), form.status === "open" ? "Form closed" : "Form is open")}><Rocket size={16} /> {form.status === "open" ? "Close" : "Open form"}</Button>
    </div></header>
    <div className="builder-layout"><aside className="builder-rail"><span>BUILD YOUR FORM</span>{stepMeta.map((item, index) => { const Icon = item.icon; return <button key={item.id} className={step === item.id ? "active" : ""} onClick={() => setStep(item.id)}><i>{index + 1}</i><Icon size={17} /><b>{item.label}</b>{form.currentVersion > index && <Check size={14} />}</button>; })}<div className="builder-completeness"><div><span>Published snapshots</span><b>{form.currentVersion}</b></div><small>Every save pins a new immutable version.</small></div></aside>
      <main className="builder-canvas">
        {form.hasNonDraftSubmissions && (step === "setup" || step === "abstract" || step === "participant") && <div className="locked-banner"><LockKeyhole size={17} /><div><b>Structure locked after submissions</b><span>You can still update labels, guidance, dates, and copy. Duplicate the form to change its structure.</span></div></div>}
        {step === "setup" && <SetupStep form={form} onChange={applyLocal} />}
        {step === "welcome" && <WelcomeStep form={form} onChange={applyLocal} />}
        {(step === "abstract" || step === "participant") && section && <FieldsStep section={section} participant={step === "participant"} form={form} selected={selected?.fieldId ?? null} onSelect={(fieldId) => setSelected({ sectionId: section.id, fieldId })} onSectionChange={(patch) => applySection(section.id, patch)} onFormChange={applyLocal} onAdd={() => setAdding(true)} onMove={(fieldId, delta) => void moveField(section, fieldId, delta)} />}
        {step === "settings" && <SettingsStep event={event} form={form} onChange={applyLocal} />}
        {step === "notifications" && <NotificationsStep form={form} onChange={applyLocal} />}
        <footer className="builder-footer"><Button variant="secondary" disabled={step === "setup"} onClick={() => setStep(BUILDER_STEPS[Math.max(0, BUILDER_STEPS.indexOf(step) - 1)] ?? step)}>Back</Button><Button disabled={busy} onClick={() => void saveStep()}><Save size={16} /> Save step</Button><Button variant="secondary" disabled={step === "notifications"} onClick={() => setStep(BUILDER_STEPS[Math.min(BUILDER_STEPS.length - 1, BUILDER_STEPS.indexOf(step) + 1)] ?? step)}>Next</Button></footer>
      </main>
      <aside className="builder-inspector">{selectedField ? <FieldInspector field={selectedField} form={form} onChange={(patch) => applyField(selectedField.id, patch)} onSave={() => void saveField(selectedField)} onDelete={() => void deleteField(selectedField)} busy={busy} /> : <BuilderPreview form={form} step={step} />}</aside>
    </div>
    <Modal open={adding} onClose={() => setAdding(false)} title="Add a question" description="Choose one of the eight supported response types." footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button disabled={!newLabel.trim() || busy} onClick={() => void addField()}>Add question</Button></>}><div className="form-stack"><Field label="Question label" required><input autoFocus value={newLabel} onChange={(current) => setNewLabel(current.target.value)} placeholder="What would you like to ask?" /></Field><Field label="Response type"><div className="type-grid">{addableTypes.map((item) => <button key={item.type} className={newType === item.type ? "active" : ""} onClick={() => setNewType(item.type)}><span>{typeIcon(item.type)}</span><div><b>{item.label}</b><small>{item.description}</small></div>{newType === item.type && <CircleCheck size={16} />}</button>)}</div></Field></div></Modal>
  </div>;
}

function SetupStep({ form, onChange }: { form: BuilderForm; onChange: (patch: FormPatch) => void }) {
  return <section className="builder-step"><header><div className="step-number">1</div><div><h2>Submission setup</h2><p>Choose the submission type and whether to collect participant details.</p></div></header><div className="builder-card form-stack"><Field label="Internal form name" required hint={`${form.internalName.length}/255`}><input maxLength={255} value={form.internalName} onChange={(current) => onChange({ internalName: current.target.value })} /></Field><Field label="Submission type"><div className="choice-cards"><button disabled={form.hasNonDraftSubmissions} className={form.kind === "abstract" ? "active" : ""} onClick={() => onChange({ kind: "abstract" })}><FileText size={20} /><b>Abstracts</b><small>Proposals reviewed before scheduling</small></button><button disabled={form.hasNonDraftSubmissions} className={form.kind === "session" ? "active" : ""} onClick={() => onChange({ kind: "session" })}><Users size={20} /><b>Sessions</b><small>Complete session submissions</small></button></div></Field><div className="inline-setting"><div><b>Collect participant information</b><small>Speaker identity fields remain protected.</small></div><button disabled={form.hasNonDraftSubmissions} className={`switch ${form.collectParticipants ? "on" : ""}`} onClick={() => onChange({ collectParticipants: !form.collectParticipants })}><i /></button></div><div className="setting-note"><FileText size={18} /><div><b>No payments step</b><p>Payments are outside this form’s scope.</p></div></div></div></section>;
}

function WelcomeStep({ form, onChange }: { form: BuilderForm; onChange: (patch: FormPatch) => void }) {
  return <section className="builder-step"><header><div className="step-number">2</div><div><h2>Welcome screen</h2><p>Set the public title, heading, and opening message.</p></div></header><div className="builder-card form-stack"><Field label="Internal form name" required hint={`${form.internalName.length}/255`}><input maxLength={255} value={form.internalName} onChange={(current) => onChange({ internalName: current.target.value })} /></Field><Field label="External form title" required hint={`${form.externalTitle.length}/255`}><input maxLength={255} value={form.externalTitle} onChange={(current) => onChange({ externalTitle: current.target.value })} /></Field><Field label="Page heading" required hint={`${form.pageHeading.length}/15`}><input maxLength={15} value={form.pageHeading} onChange={(current) => onChange({ pageHeading: current.target.value })} /></Field><div className="inline-setting"><div><b>Show welcome message</b><small>Speakers see this before starting.</small></div><button className={`switch ${form.showWelcome ? "on" : ""}`} onClick={() => onChange({ showWelcome: !form.showWelcome })}><i /></button></div>{form.showWelcome && <Field label="Welcome message"><RichTextEditor value={form.welcomeHtml} onChange={(welcomeHtml) => onChange({ welcomeHtml })} maxChars={5000} /></Field>}</div></section>;
}

function FieldsStep({ section, participant, form, selected, onSelect, onSectionChange, onFormChange, onAdd, onMove }: { section: BuilderSection; participant: boolean; form: BuilderForm; selected: string | null; onSelect: (fieldId: string) => void; onSectionChange: (patch: Partial<BuilderSection>) => void; onFormChange: (patch: FormPatch) => void; onAdd: () => void; onMove: (fieldId: string, delta: -1 | 1) => void }) {
  return <section className="builder-step"><header><div className="step-number">{participant ? 4 : 3}</div><div><h2>{participant ? "Participant information" : "Abstract information"}</h2><p>{participant ? "Collect speaker and co-speaker information." : "Build the proposal your review team will score."}</p></div></header><div className="builder-card form-stack"><Field label="Section title" required hint={`${section.title.length}/255`}><input maxLength={255} value={section.title} onChange={(current) => onSectionChange({ title: current.target.value })} /></Field><Field label="Page heading" required hint={`${section.pageHeading.length}/15`}><input maxLength={15} value={section.pageHeading} onChange={(current) => onSectionChange({ pageHeading: current.target.value })} /></Field><Field label="Description and instructions"><RichTextEditor value={section.descriptionHtml} onChange={(descriptionHtml) => onSectionChange({ descriptionHtml })} maxChars={5000} /></Field></div><div className="builder-card field-section"><div className="section-heading"><div><h3>Form questions</h3><p>{section.fields.length} live questions</p></div></div><div className="builder-fields">{section.fields.map((field, index) => <div className={selected === field.id ? "selected builder-field-row" : "builder-field-row"} key={field.id}><button className="field-row-main" onClick={() => onSelect(field.id)}><span className="field-type-icon">{typeIcon(field.fieldType)}</span><div><b>{field.label}{field.required && <em>*</em>}</b><small>{typeLabel(field.fieldType)}{field.visibility ? " · Conditional" : ""}</small></div>{field.locked && <LockKeyhole size={14} className="lock" />}</button><button className="icon-button" aria-label={`Move ${field.label} up`} disabled={index === 0 || busyLock(form)} onClick={() => onMove(field.id, -1)}><ArrowUp size={14} /></button><button className="icon-button" aria-label={`Move ${field.label} down`} disabled={index === section.fields.length - 1 || busyLock(form)} onClick={() => onMove(field.id, 1)}><ArrowDown size={14} /></button></div>)}</div><Button variant="ghost" className="add-question" disabled={form.hasNonDraftSubmissions} onClick={onAdd}><Plus size={16} /> Add question</Button>{!participant && <div className="setting-note"><SlidersHorizontal size={18} /><div><b>Routing rules</b><p>Existing routing rules continue to run against field ids. Rule authoring is completed in the Routing Rules module.</p></div></div>}</div>{participant && <ParticipantRoles form={form} onChange={onFormChange} />}</section>;
}

function ParticipantRoles({ form, onChange }: { form: BuilderForm; onChange: (patch: FormPatch) => void }) {
  return <div className="builder-card"><h3>Participant roles</h3><div className="toggle-list">{form.participantRoles.map((role) => <div key={role.role}><div><b>{role.role.replaceAll("_", "-")}</b><p>Allow this role on submitted proposals.</p></div><button className={`switch ${role.enabled ? "on" : ""}`} onClick={() => onChange({ participantRoles: form.participantRoles.map((candidate) => candidate.role === role.role ? { ...candidate, enabled: !candidate.enabled } : candidate) })}><i /></button></div>)}</div></div>;
}

function SettingsStep({ event, form, onChange }: { event: BuilderEvent; form: BuilderForm; onChange: (patch: FormPatch) => void }) {
  return <section className="builder-step"><header><div className="step-number">5</div><div><h2>Form settings</h2><p>Control availability, limits, and the completion experience.</p></div></header><div className="builder-card"><h3>Dates and availability</h3><div className="form-grid"><Field label="Opens"><input type="datetime-local" value={localInputValue(form.opensAt, event.timezone)} onChange={(current) => onChange({ opensAt: current.target.value ? zonedInputToUtc(current.target.value, event.timezone).toISOString() : null })} /></Field><Field label="Closes"><input type="datetime-local" value={localInputValue(form.closesAt, event.timezone)} onChange={(current) => onChange({ closesAt: current.target.value ? zonedInputToUtc(current.target.value, event.timezone).toISOString() : null })} /></Field></div><div className="timezone-note">All dates use {event.timezone}.</div></div><div className="builder-card form-stack"><Field label="Submission limit"><input type="number" min={1} max={100000} value={form.submissionLimit ?? ""} onChange={(current) => onChange({ submissionLimit: current.target.value ? Number(current.target.value) : null })} /></Field><Field label="Success message"><RichTextEditor value={form.successHtml} onChange={(successHtml) => onChange({ successHtml })} maxChars={5000} /></Field><div className="inline-setting"><div><b>Redirect to speaker portal</b><small>Open the portal after a successful submission.</small></div><button className={`switch ${form.autoRedirectToPortal ? "on" : ""}`} onClick={() => onChange({ autoRedirectToPortal: !form.autoRedirectToPortal })}><i /></button></div></div></section>;
}

function NotificationsStep({ form, onChange }: { form: BuilderForm; onChange: (patch: FormPatch) => void }) {
  return <section className="builder-step"><header><div className="step-number">6</div><div><h2>Notifications</h2><p>Configure the receipt sent after a proposal arrives.</p></div></header><div className="builder-card form-stack"><div className="inline-setting"><div><b>Send confirmation to the speaker</b><small>Queued through the transactional outbox.</small></div><button className={`switch ${form.sendConfirmation ? "on" : ""}`} onClick={() => onChange({ sendConfirmation: !form.sendConfirmation })}><i /></button></div><Field label="Subject"><input maxLength={255} value={form.confirmationSubject} onChange={(current) => onChange({ confirmationSubject: current.target.value })} placeholder="We received your proposal" /></Field><Field label="Email body"><RichTextEditor value={form.confirmationBodyHtml} onChange={(confirmationBodyHtml) => onChange({ confirmationBodyHtml })} maxChars={5000} /></Field></div></section>;
}

function FieldInspector({ field, form, onChange, onSave, onDelete, busy }: { field: BuilderField; form: BuilderForm; onChange: (patch: Partial<BuilderField>) => void; onSave: () => void; onDelete: () => void; busy: boolean }) {
  const flattened = form.sections.flatMap((section) => section.fields);
  const position = flattened.findIndex((candidate) => candidate.id === field.id);
  const earlier = flattened.slice(0, position);
  const lockedStructure = form.hasNonDraftSubmissions;
  function visibility(enabled: boolean) {
    if (!enabled) return onChange({ visibility: null });
    const source = earlier[0];
    if (source) onChange({ visibility: { match: "all", conditions: [{ sourceFieldId: source.id, op: "eq", value: source.options[0]?.id ?? "Yes" }] } });
  }
  const condition = field.visibility?.conditions[0];
  function updateCondition(patch: Partial<NonNullable<VisibilityRule>["conditions"][number]>) {
    if (!condition) return;
    onChange({ visibility: { match: field.visibility?.match ?? "all", conditions: [{ ...condition, ...patch }] } });
  }
  return <div className="inspector-content"><header><div><span>QUESTION</span><h3>Edit field</h3></div>{field.locked && <StatusBadge value="Locked" />}</header><div className="form-stack">
    <Field label="Label"><input maxLength={255} value={field.label} onChange={(current) => onChange({ label: current.target.value })} /></Field>
    <Field label="Key" hint={field.locked || lockedStructure ? "Keys are immutable for this field." : "Used by integrations and stays stable when labels change."}><input disabled={field.locked || lockedStructure} value={field.key} onChange={(current) => onChange({ key: current.target.value })} /></Field>
    <Field label="Response type"><select disabled={field.locked || lockedStructure} value={field.fieldType} onChange={(current) => onChange({ fieldType: current.target.value as FieldType })}>{addableTypes.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select></Field>
    <Field label="Help text"><textarea value={field.helpText} onChange={(current) => onChange({ helpText: current.target.value })} /></Field>
    {["text", "textarea", "richtext"].includes(field.fieldType) && <Field label="Maximum characters"><input type="number" min={1} value={field.maxChars ?? ""} onChange={(current) => onChange({ maxChars: current.target.value ? Number(current.target.value) : null })} /></Field>}
    <div className="inline-setting"><div><b>Required</b><small>Speakers must answer this question.</small></div><button disabled={field.locked || lockedStructure} className={`switch ${field.required ? "on" : ""}`} onClick={() => onChange({ required: !field.required })}><i /></button></div>
    {["dropdown", "multiselect"].includes(field.fieldType) && <Field label="Options" hint={lockedStructure ? "Options are locked after the first submission." : field.mapsTo === "submission.track_id" ? "One existing event track per line; bindings are validated on save." : field.mapsTo === "submission.format_id" ? "One existing session format per line; bindings are validated on save." : "One option per line; existing option ids are preserved."}><textarea disabled={lockedStructure} value={field.options.map((option) => option.label).join("\n")} onChange={(current) => onChange({ options: current.target.value.split("\n").map((label, index) => ({ ...(field.options[index] ?? { id: `draft-${index}` }), label })) })} /></Field>}
    {!field.locked && <Field label="Maps to"><select disabled={lockedStructure} value={field.mapsTo ?? ""} onChange={(current) => onChange({ mapsTo: (current.target.value || null) as MapsToTarget | null })}><option value="">No system mapping</option>{MAPS_TO_TARGETS.map((target) => <option key={target} value={target}>{target}</option>)}</select></Field>}
    {!field.locked && <div className="condition-card"><div><b>Conditional visibility</b><small>Conditions may reference only earlier questions.</small></div><button disabled={lockedStructure || earlier.length === 0} className={`switch ${field.visibility ? "on" : ""}`} onClick={() => visibility(!field.visibility)}><i /></button>{condition && <div className="condition-editor"><span>Show when</span><select disabled={lockedStructure} value={condition.sourceFieldId} onChange={(current) => updateCondition({ sourceFieldId: current.target.value as BuilderField["id"] })}>{earlier.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.label}</option>)}</select><select disabled={lockedStructure} value={condition.op} onChange={(current) => { const op = current.target.value as (typeof CONDITION_OPS)[number]; updateCondition({ op, value: op === "answered" || op === "empty" ? undefined : condition.value ?? "" }); }}>{CONDITION_OPS.map((op) => <option key={op} value={op}>{op === "in" ? "contains option" : op.replaceAll("_", " ")}</option>)}</select>{!["answered", "empty"].includes(condition.op) && <input disabled={lockedStructure} value={typeof condition.value === "string" ? condition.value : ""} onChange={(current) => updateCondition({ value: current.target.value })} placeholder="Value or option id" />}</div>}</div>}
    <Button disabled={busy} onClick={onSave}><Save size={15} /> Save question</Button>
    {!field.locked && <Button variant="ghost" disabled={busy || lockedStructure} className="delete-field" onClick={onDelete}><Trash2 size={15} /> Delete question</Button>}
  </div></div>;
}

function BuilderPreview({ form, step }: { form: BuilderForm; step: BuilderStep }) {
  const section = form.sections.find((candidate) => candidate.key === (step === "participant" ? "participant" : "abstract"));
  return <div className="preview-pane"><header><span>LIVE PREVIEW</span><b>Desktop</b></header><div className="mini-browser"><div className="mini-browser-top"><i /><i /><i /></div><div className="mini-public"><span className="mini-event-logo">Openboard</span>{step === "welcome" ? <><small>CALL FOR SPEAKERS</small><h3>{form.pageHeading}</h3><RichTextView html={form.welcomeHtml} /><button>Get started</button></> : <><div className="mini-stepper"><i className="done" /><i className="active" /><i /><i /></div><small>{step === "settings" ? "REVIEW & SUBMIT" : "YOUR SESSION"}</small><h3>{section?.pageHeading ?? form.externalTitle}</h3>{section?.fields.slice(0, 3).map((field) => <label key={field.id}><span>{field.label}</span><i>{field.helpText || "Your answer"}</i></label>)}</>}</div></div><p className="preview-hint"><Eye size={14} /> Preview updates as you edit.</p></div>;
}

function busyLock(form: BuilderForm) { return form.sections.length === 0; }
function typeLabel(type: FieldType) { return addableTypes.find((item) => item.type === type)?.label ?? type; }
function typeIcon(type: FieldType) { const labels: Record<string, string> = { text: "T", textarea: "¶", richtext: "Aa", dropdown: "⌄", multiselect: "☷", email: "@", url: "↗", file: "↑" }; return labels[type] ?? "T"; }
