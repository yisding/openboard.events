"use client";

import Link from "next/link";
import { ArrowLeft, Bell, Check, ChevronRight, CircleCheck, Eye, FileText, GripVertical, LockKeyhole, MessageSquareText, MoreHorizontal, Plus, Rocket, Settings2, SlidersHorizontal, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { useDemo } from "@/shared/demo/demo-provider";
import { Button, Field, Modal, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { FieldType } from "@/shared/contracts";
import type { FormFieldRecord, FormRecord } from "@/shared/demo/types";

const steps = [
  { id: "setup", label: "Setup", icon: Settings2 }, { id: "welcome", label: "Welcome", icon: MessageSquareText },
  { id: "abstract", label: "Abstract", icon: FileText }, { id: "participant", label: "Participant", icon: Users },
  { id: "settings", label: "Settings", icon: SlidersHorizontal }, { id: "notifications", label: "Notifications", icon: Bell },
] as const;
type BuilderStep = (typeof steps)[number]["id"];

const addableTypes: Array<{ type: FieldType; label: string; description: string }> = [
  { type: "text", label: "Short text", description: "A single line response" }, { type: "textarea", label: "Long text", description: "A paragraph response" },
  { type: "richtext", label: "Rich text", description: "Formatted long-form answer" }, { type: "dropdown", label: "Dropdown", description: "Choose one option" },
  { type: "multiselect", label: "Multi-select", description: "Choose several options" }, { type: "email", label: "Email", description: "Validated email address" },
  { type: "url", label: "Website", description: "Validated web address" }, { type: "file", label: "File upload", description: "PDF, slides, or document" },
];

export function FormBuilder({ eventId, formId }: { eventId: string; formId: string }) {
  const { state, dispatch } = useDemo();
  const { toast } = useToast();
  const event = state.events.find((item) => item.id === eventId);
  const form = state.forms.find((item) => item.id === formId && item.eventId === eventId);
  const [step, setStep] = useState<BuilderStep>("abstract");
  const [selected, setSelected] = useState<{ sectionId: string; fieldId: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<FieldType>("text");
  const [newLabel, setNewLabel] = useState("");
  const [saved, setSaved] = useState(true);
  const structuralLocked = (form?.submissions ?? 0) > 0;
  const selectedField = useMemo(() => form?.sections.find((section) => section.id === selected?.sectionId)?.fields.find((field) => field.id === selected?.fieldId), [form, selected]);

  if (!form || !event) return <div className="empty-state"><h3>Form not found</h3><Link className="button button-secondary" href="/events">Back to events</Link></div>;
  const currentForm = form;

  function updateForm(patch: Partial<FormRecord>) {
    dispatch({ type: "UPDATE_FORM", formId: currentForm.id, patch }); setSaved(false); window.setTimeout(() => setSaved(true), 500);
  }
  function updateField(patch: Partial<FormFieldRecord>) {
    if (!selected) return; dispatch({ type: "UPDATE_FIELD", formId: currentForm.id, sectionId: selected.sectionId, fieldId: selected.fieldId, patch }); setSaved(false); window.setTimeout(() => setSaved(true), 500);
  }
  function addField() {
    const section = currentForm.sections.find((item) => step === "participant" ? item.id.includes("speaker") : !item.id.includes("speaker")) ?? currentForm.sections[0];
    if (!section || !newLabel.trim()) return;
    // Answer keys must be unique across the form: answers are stored by key,
    // so a collision would make two questions overwrite each other.
    const existingKeys = new Set(currentForm.sections.flatMap((item) => item.fields).map((item) => item.key));
    const base = newLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "question";
    let key = base;
    for (let suffix = 2; existingKeys.has(key); suffix += 1) key = `${base}_${suffix}`;
    const field: FormFieldRecord = { id: `fld_${Date.now()}`, key, label: newLabel.trim(), type: newType, required: false, locked: false, helpText: "", placeholder: "", maxChars: ["text", "textarea", "richtext"].includes(newType) ? 500 : null, options: ["dropdown", "multiselect"].includes(newType) ? ["Option 1", "Option 2"] : [] };
    dispatch({ type: "ADD_FIELD", formId: currentForm.id, sectionId: section.id, field }); setAdding(false); setNewLabel(""); setSelected({ sectionId: section.id, fieldId: field.id }); toast("Question added");
  }
  function publish() { updateForm({ status: currentForm.status === "open" ? "draft" : "open" }); toast(currentForm.status === "open" ? "Form moved to draft" : "Form is live and accepting submissions"); }

  return <div className="builder-wrap">
    <header className="builder-header"><div className="builder-title"><Link className="icon-button" href={`/events/${event.id}/forms`}><ArrowLeft size={18} /></Link><div><div><h1>{form.name}</h1><StatusBadge value={form.status} /></div><span>Version {form.version} · <i className={saved ? "saved" : "saving"}>{saved ? "All changes saved" : "Saving…"}</i></span></div></div><div className="builder-actions"><Link className="button button-secondary" target="_blank" href={`/submit/${event.slug}/${form.id}`}><Eye size={16} /> Preview</Link><Button onClick={publish}>{form.status === "open" ? "Unpublish" : <><Rocket size={16} /> Publish form</>}</Button></div></header>
    <div className="builder-layout"><aside className="builder-rail"><span>BUILD YOUR FORM</span>{steps.map((item, index) => { const Icon = item.icon; return <button key={item.id} className={step === item.id ? "active" : ""} onClick={() => { setStep(item.id); setSelected(null); }}><i>{index + 1}</i><Icon size={17} /><b>{item.label}</b>{index < 2 && <Check size={14} />}</button>; })}<div className="builder-completeness"><div><span>Form readiness</span><b>86%</b></div><div className="progress-track"><i style={{ width: "86%" }} /></div><small>Add a close date to finish setup.</small></div></aside>
      <main className="builder-canvas">{structuralLocked && (step === "abstract" || step === "participant") && <div className="locked-banner"><LockKeyhole size={17} /><div><b>Structure locked after submissions</b><span>You can still update labels, guidance, and copy. Duplicate this form to change questions.</span></div></div>}
        {step === "setup" && <SetupStep name={form.name} status={form.status} onUpdate={updateForm} />}
        {step === "welcome" && <WelcomeStep title={form.welcomeTitle} body={form.welcomeBody} onUpdate={updateForm} />}
        {(step === "abstract" || step === "participant") && <FieldsStep form={form} participant={step === "participant"} selected={selected?.fieldId ?? null} onSelect={(sectionId, fieldId) => setSelected({ sectionId, fieldId })} onAdd={() => setAdding(true)} locked={structuralLocked} />}
        {step === "settings" && <SettingsStep form={form} onUpdate={updateForm} />}
        {step === "notifications" && <NotificationsStep />}
      </main>
      <aside className="builder-inspector">{selectedField && selected ? <FieldInspector field={selectedField} form={form} onChange={updateField} onDelete={() => { dispatch({ type: "DELETE_FIELD", formId: form.id, sectionId: selected.sectionId, fieldId: selected.fieldId }); setSelected(null); toast("Question removed"); }} locked={structuralLocked} /> : <BuilderPreview form={form} step={step} />}</aside>
    </div>
    <Modal open={adding} onClose={() => setAdding(false)} title="Add a question" description="Choose the response type, then customize it in the inspector." footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button disabled={!newLabel.trim()} onClick={addField}>Add question</Button></>}><div className="form-stack"><Field label="Question label" required><input autoFocus value={newLabel} onChange={(event) => setNewLabel(event.target.value)} placeholder="What would you like to ask?" /></Field><Field label="Response type"><div className="type-grid">{addableTypes.map((item) => <button key={item.type} className={newType === item.type ? "active" : ""} onClick={() => setNewType(item.type)}><span>{typeIcon(item.type)}</span><div><b>{item.label}</b><small>{item.description}</small></div>{newType === item.type && <CircleCheck size={16} />}</button>)}</div></Field></div></Modal>
  </div>;
}

function SetupStep({ name, status, onUpdate }: { name: string; status: string; onUpdate: (patch: { name?: string; status?: "draft" | "open" | "closed" }) => void }) {
  return <section className="builder-step"><header><div className="step-number">1</div><div><h2>Form setup</h2><p>Name your form and choose how it will be used.</p></div></header><div className="builder-card form-stack"><Field label="Form name" required><input value={name} onChange={(event) => onUpdate({ name: event.target.value })} /></Field><Field label="Form status"><select value={status} onChange={(event) => onUpdate({ status: event.target.value as "draft" | "open" | "closed" })}><option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option></select></Field><div className="setting-note"><FileText size={18} /><div><b>Call for speakers</b><p>This form includes submission, participant, and review steps. Payments are not needed for this event.</p></div></div></div></section>;
}
function WelcomeStep({ title, body, onUpdate }: { title: string; body: string; onUpdate: (patch: { welcomeTitle?: string; welcomeBody?: string }) => void }) {
  return <section className="builder-step"><header><div className="step-number">2</div><div><h2>Welcome</h2><p>Set the tone and tell speakers what you’re looking for.</p></div></header><div className="builder-card form-stack"><Field label="Headline" required><input value={title} onChange={(event) => onUpdate({ welcomeTitle: event.target.value })} /></Field><Field label="Introduction" hint="Keep this concise. You can add submission guidance below."><textarea value={body} onChange={(event) => onUpdate({ welcomeBody: event.target.value })} /></Field><Field label="Guidance link"><input placeholder="https://your-event.com/speaker-guide" /></Field></div></section>;
}
function FieldsStep({ form, participant, selected, onSelect, onAdd, locked }: { form: import("@/shared/demo/types").FormRecord; participant: boolean; selected: string | null; onSelect: (sectionId: string, fieldId: string) => void; onAdd: () => void; locked: boolean }) {
  const sections = form.sections.filter((section) => participant ? section.id.includes("speaker") : !section.id.includes("speaker"));
  const displayed = sections.length ? sections : form.sections;
  return <section className="builder-step"><header><div className="step-number">{participant ? 4 : 3}</div><div><h2>{participant ? "Participant details" : "Abstract questions"}</h2><p>{participant ? "Collect speaker and co-speaker information." : "Build the proposal your review team will score."}</p></div></header>{displayed.map((section) => <div className="builder-card field-section" key={section.id}><div className="section-heading"><div><input defaultValue={section.title} aria-label="Section title" /><p>{section.description}</p></div><button className="icon-button"><MoreHorizontal size={17} /></button></div><div className="builder-fields">{section.fields.map((field) => <button key={field.id} className={selected === field.id ? "selected" : ""} onClick={() => onSelect(section.id, field.id)}><GripVertical size={16} className="drag-handle"/><span className="field-type-icon">{typeIcon(field.type)}</span><div><b>{field.label}{field.required && <em>*</em>}</b><small>{typeLabel(field.type)}{field.visibility ? " · Conditional" : ""}</small></div>{field.locked && <LockKeyhole size={14} className="lock" />}<ChevronRight size={16} /></button>)}</div><Button variant="ghost" className="add-question" disabled={locked} onClick={onAdd}><Plus size={16} /> Add question</Button></div>)}</section>;
}
function SettingsStep({ form, onUpdate }: { form: import("@/shared/demo/types").FormRecord; onUpdate: (patch: Partial<import("@/shared/demo/types").FormRecord>) => void }) {
  return <section className="builder-step"><header><div className="step-number">5</div><div><h2>Submission settings</h2><p>Control dates, capacity, and the completion experience.</p></div></header><div className="builder-card"><h3>Dates & availability</h3><div className="form-grid"><Field label="Opens"><input type="datetime-local" value={form.opensAt ? form.opensAt.slice(0,16) : ""} onChange={(event) => onUpdate({ opensAt: event.target.value ? new Date(event.target.value).toISOString() : "" })} /></Field><Field label="Closes"><input type="datetime-local" value={form.closesAt ? form.closesAt.slice(0,16) : ""} onChange={(event) => onUpdate({ closesAt: event.target.value ? new Date(event.target.value).toISOString() : "" })} /></Field></div><div className="timezone-note">All dates use America/Los_Angeles (PDT).</div></div><div className="builder-card"><h3>Submission capacity</h3><div className="form-grid"><Field label="Total submissions"><input type="number" value={form.submissionLimit} onChange={(event) => onUpdate({ submissionLimit: Number(event.target.value) })} /></Field><Field label="Per speaker"><input type="number" value={form.maxPerSpeaker} onChange={(event) => onUpdate({ maxPerSpeaker: Number(event.target.value) })} /></Field></div></div><div className="builder-card form-stack"><h3>After submission</h3><Field label="Success headline"><input value={form.successTitle} onChange={(event) => onUpdate({ successTitle: event.target.value })} /></Field><Field label="Success message"><textarea value={form.successBody} onChange={(event) => onUpdate({ successBody: event.target.value })} /></Field></div></section>;
}
function NotificationsStep() {
  const [receipt, setReceipt] = useState(true); const [team, setTeam] = useState(true);
  return <section className="builder-step"><header><div className="step-number">6</div><div><h2>Notifications</h2><p>Choose what is sent when a proposal arrives.</p></div></header><div className="builder-card toggle-list"><div><span className="metric-icon purple"><Bell size={18} /></span><div><b>Send a confirmation to the speaker</b><p>Uses the “Submission received” template.</p></div><button className={`switch ${receipt ? "on" : ""}`} onClick={() => setReceipt(!receipt)}><i /></button></div><div><span className="metric-icon blue"><Users size={18} /></span><div><b>Notify the organizing team</b><p>Sends a concise proposal summary to event owners.</p></div><button className={`switch ${team ? "on" : ""}`} onClick={() => setTeam(!team)}><i /></button></div></div><div className="builder-card"><h3>Email preview</h3><div className="email-preview"><small>SUBJECT</small><b>We received your proposal, {"{{contact.first_name}}"}</b><p>Thanks for submitting <strong>{"{{submission.title}}"}</strong> to AI Engineer World’s Fair. We’ll be in touch after the review period closes.</p></div></div></section>;
}
function FieldInspector({ field, form, onChange, onDelete, locked }: { field: FormFieldRecord; form: FormRecord; onChange: (patch: Partial<FormFieldRecord>) => void; onDelete: () => void; locked: boolean }) {
  const earlier = form.sections.flatMap((section) => section.fields).filter((item) => item.id !== field.id);
  const visibility = field.visibility;
  return <div className="inspector-content">
    <header><div><span>QUESTION</span><h3>Edit field</h3></div>{field.locked && <StatusBadge value="Locked" />}</header>
    <div className="form-stack">
      <Field label="Label"><input value={field.label} onChange={(event) => onChange({ label: event.target.value })} /></Field>
      <Field label="Help text"><textarea value={field.helpText} onChange={(event) => onChange({ helpText: event.target.value })} /></Field>
      <Field label="Placeholder"><input value={field.placeholder} onChange={(event) => onChange({ placeholder: event.target.value })} /></Field>
      <div className="inline-setting"><div><b>Required</b><small>Speakers must answer this question</small></div><button className={`switch ${field.required ? "on" : ""}`} onClick={() => !field.locked && onChange({ required: !field.required })}><i /></button></div>
      {field.options.length > 0 && <Field label="Options" hint={locked ? "Options are locked while the form has submissions — saved answers reference them." : "One option per line"}><textarea disabled={locked} value={field.options.join("\n")} onChange={(event) => { if (locked) return; onChange({ options: event.target.value.split("\n").filter(Boolean) }); }} /></Field>}
      <div className="condition-card"><div><b>Conditional visibility</b><small>{field.locked ? "Locked identity fields are always visible." : locked ? "Visibility rules are locked while the form has submissions." : "Show this question based on an earlier answer."}</small></div><button disabled={field.locked || locked} className={`switch ${visibility ? "on" : ""}`} onClick={() => { if (field.locked || locked) return; onChange({ visibility: visibility ? null : { fieldId: earlier[0]?.id ?? "", operator: "eq", value: "Yes" } }); }}><i /></button>
        {visibility && !field.locked && <div className="condition-editor"><span>Show when</span><select disabled={locked} value={visibility.fieldId} onChange={(event) => onChange({ visibility: { ...visibility, fieldId: event.target.value } })}>{earlier.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select><select disabled={locked} value={visibility.operator} onChange={(event) => onChange({ visibility: { ...visibility, operator: event.target.value as "eq" | "neq" | "answered" | "empty" } })}><option value="eq">is</option><option value="neq">is not</option><option value="answered">is answered</option><option value="empty">is empty</option></select>{["eq", "neq"].includes(visibility.operator) && <input disabled={locked} value={visibility.value ?? ""} onChange={(event) => onChange({ visibility: { ...visibility, value: event.target.value } })} placeholder="Value" />}</div>}
      </div>
      {!field.locked && <Button variant="ghost" disabled={locked} className="delete-field" onClick={onDelete}><Trash2 size={15} /> Delete question</Button>}
    </div>
  </div>;
}
function BuilderPreview({ form, step }: { form: import("@/shared/demo/types").FormRecord; step: BuilderStep }) {
  return <div className="preview-pane"><header><span>LIVE PREVIEW</span><b>Desktop</b></header><div className="mini-browser"><div className="mini-browser-top"><i/><i/><i/></div><div className="mini-public"><span className="mini-event-logo">AI.engineer</span>{step === "welcome" ? <><small>CALL FOR SPEAKERS</small><h3>{form.welcomeTitle}</h3><p>{form.welcomeBody}</p><button>Get started</button></> : <><div className="mini-stepper"><i className="done"/><i className="active"/><i/><i/></div><small>{step === "settings" ? "REVIEW & SUBMIT" : "YOUR SESSION"}</small><h3>{step === "participant" ? "Tell us about you" : "Share your idea"}</h3>{form.sections[0]?.fields.slice(0, 3).map((field) => <label key={field.id}><span>{field.label}</span><i>{field.placeholder || "Your answer"}</i></label>)}</>}</div></div><p className="preview-hint"><Eye size={14}/> Preview updates as you edit.</p></div>;
}
function typeLabel(type: FieldType) { return addableTypes.find((item) => item.type === type)?.label ?? type; }
function typeIcon(type: FieldType) { const labels: Record<string, string> = { text: "T", textarea: "¶", richtext: "Aa", dropdown: "⌄", multiselect: "☷", email: "@", url: "↗", file: "↑" }; return labels[type] ?? "T"; }
