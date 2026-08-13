"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Contact2,
  LockKeyhole,
  Plus,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import type { BuilderEvent, BuilderField, BuilderForm, FormPatch } from "@/features/forms";
// M14's Notifications step is generic across `context` — it only reads/writes
// `sendConfirmation`/`confirmationSubject`/`confirmationBodyHtml`, plain
// `forms` columns shared by CFP and portal forms (M24 §4) — so it is reused
// here verbatim rather than rebuilt.
import { NotificationsStep } from "@/features/forms/components/builder/notifications-step";
import { COMMITTED_FIELD_TYPES } from "@/shared/contracts";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { editorDraftChanged, requestGuardedEditorClose } from "@/shared/ui/app/modal-editor-guard";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Field, Modal, Switch } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { committedTypeLabel, standardFieldsFor, type StandardFieldItem } from "./field-library";

async function requestData<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = await response.json() as { data?: T; error?: { message?: string } };
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message ?? "The form could not be saved");
  return payload.data;
}

function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) };
}

export function validatePortalFormMetadata(internalName: string, externalTitle: string):
  | { ok: true; internalName: string; externalTitle: string }
  | { ok: false; message: string } {
  const trimmedInternalName = internalName.trim();
  if (!trimmedInternalName) return { ok: false, message: "Internal form name is required" };
  const trimmedExternalTitle = externalTitle.trim();
  if (!trimmedExternalTitle) return { ok: false, message: "Public title is required" };
  return { ok: true, internalName: trimmedInternalName, externalTitle: trimmedExternalTitle };
}

export function normalizePortalFieldLabel(label: string): string | null {
  const trimmed = label.trim();
  return trimmed || null;
}

/** Keep local notification edits when a field-only mutation returns a fresh form. */
export function mergePortalTopLevelDraft(server: BuilderForm, local: BuilderForm): BuilderForm {
  return {
    ...server,
    sendConfirmation: local.sendConfirmation,
    confirmationSubject: local.confirmationSubject,
    confirmationBodyHtml: local.confirmationBodyHtml,
  };
}

/**
 * M24 — the portal builder: one page, top-to-bottom (Setup → Questions →
 * Settings, collapsed), never a wizard (M24 §4, a deliberate simplification
 * vs. the CFP builder's 6-step shell). No visibility/routing UI anywhere in
 * this file, ever (M24 §6) — a portal form's fields never carry a
 * `visibility` rule; the field-CRUD engine underneath is M12's, unmodified.
 */
export function PortalFormBuilder({ event, initialForm }: { event: BuilderEvent; initialForm: BuilderForm }) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState(initialForm);
  const [internalName, setInternalName] = useState(initialForm.internalName);
  const [externalTitle, setExternalTitle] = useState(initialForm.externalTitle);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customType, setCustomType] = useState<(typeof COMMITTED_FIELD_TYPES)[number]>("text");
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BuilderField | null>(null);
  const customFieldDraftDirty = customOpen && (customLabel.trim().length > 0 || customType !== "text");
  useUnsavedWorkGuard(dirty || customFieldDraftDirty);
  const { runGuarded } = useGuardedAction();

  const section = form.sections[0] ?? null;
  const targetType = form.targetType ?? "contact";
  const usedMappings = new Set(form.sections.flatMap((candidate) => candidate.fields).map((field) => field.mapsTo).filter(Boolean));
  const library = standardFieldsFor(targetType).filter((item) => (
    !usedMappings.has(item.mapsTo)
    && item.label.toLowerCase().includes(librarySearch.trim().toLowerCase())
  ));
  const selectedField = section?.fields.find((field) => field.id === selectedFieldId) ?? null;

  function apiPath(path: string): string {
    return `/api/internal/forms/${form.id}${path}?eventId=${event.id}`;
  }

  /** The single Save button: Setup (name/title) + Settings, one PATCH call — M24 §4's "one `saveFormStep`-equivalent call" per visit. */
  async function saveTopLevel() {
    if (busy) return;
    const metadata = validatePortalFormMetadata(internalName, externalTitle);
    if (!metadata.ok) {
      toast(metadata.message, { kind: "error" });
      return;
    }
    setBusy(true);
    try {
      const patch: FormPatch = {
        internalName: metadata.internalName,
        externalTitle: metadata.externalTitle,
        sendConfirmation: form.sendConfirmation,
        confirmationSubject: form.confirmationSubject,
        confirmationBodyHtml: form.confirmationBodyHtml,
      };
      const next = await requestData<BuilderForm>(apiPath(""), json("PATCH", { expectedUpdatedAt: form.updatedAt, patch }));
      setForm(next);
      setInternalName(next.internalName);
      setExternalTitle(next.externalTitle);
      setDirty(false);
      toast("Saved");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "The form could not be saved", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function addStandardField(item: StandardFieldItem) {
    if (!section || busy) return;
    setBusy(true);
    try {
      const next = await requestData<BuilderForm>(apiPath("/fields"), json("POST", {
        expectedUpdatedAt: form.updatedAt,
        sectionId: section.id,
        label: item.label,
        fieldType: item.fieldType,
        mapsTo: item.mapsTo,
        ...(item.defaultOptionLabels ? { optionLabels: [...item.defaultOptionLabels] } : {}),
      }));
      setForm((current) => mergePortalTopLevelDraft(next, current));
      toast(`${item.label} added`);
      setLibraryOpen(false);
      setLibrarySearch("");
    } catch (error) {
      toast(error instanceof Error ? error.message : "The field could not be added", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function addCustomField() {
    const label = normalizePortalFieldLabel(customLabel);
    if (!section || !label || busy) return;
    setBusy(true);
    try {
      const next = await requestData<BuilderForm>(apiPath("/fields"), json("POST", {
        expectedUpdatedAt: form.updatedAt,
        sectionId: section.id,
        label,
        fieldType: customType,
      }));
      setForm((current) => mergePortalTopLevelDraft(next, current));
      toast("Question added");
      setCustomOpen(false);
      setLibraryOpen(false);
      setCustomLabel("");
      setCustomType("text");
    } catch (error) {
      toast(error instanceof Error ? error.message : "The question could not be added", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function saveField(patch: { label: string; helpText: string; required: boolean; maxChars: number | null; optionLabels?: string[] }): Promise<BuilderField | null> {
    if (!selectedField || busy) return null;
    const label = normalizePortalFieldLabel(patch.label);
    if (!label) {
      toast("Question label is required", { kind: "error" });
      return null;
    }
    setBusy(true);
    try {
      const next = await requestData<BuilderForm>(apiPath(`/fields/${selectedField.id}`), json("PATCH", {
        expectedUpdatedAt: form.updatedAt,
        patch: { ...patch, label },
      }));
      setForm((current) => mergePortalTopLevelDraft(next, current));
      toast("Question saved");
      return next.sections.flatMap((candidate) => candidate.fields).find((candidate) => candidate.id === selectedField.id) ?? null;
    } catch (error) {
      toast(error instanceof Error ? error.message : "The question could not be saved", { kind: "error" });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function deleteField(field: BuilderField) {
    if (busy) return;
    setBusy(true);
    try {
      const next = await requestData<BuilderForm>(apiPath(`/fields/${field.id}`), json("DELETE", { expectedUpdatedAt: form.updatedAt }));
      setForm((current) => mergePortalTopLevelDraft(next, current));
      setSelectedFieldId(null);
      setPendingDelete(null);
      toast("Question removed");
    } catch (error) {
      toast(error instanceof Error ? error.message : "The question could not be removed", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function moveField(fieldId: string, delta: -1 | 1) {
    if (!section || busy) return;
    const current = section.fields.findIndex((field) => field.id === fieldId);
    const target = current + delta;
    if (current < 0 || target < 0 || target >= section.fields.length) return;
    const ordered = section.fields.map((field) => field.id);
    const currentId = ordered[current];
    const targetId = ordered[target];
    if (!currentId || !targetId) return;
    ordered[current] = targetId;
    ordered[target] = currentId;
    setBusy(true);
    try {
      const next = await requestData<BuilderForm>(apiPath("/fields/reorder"), json("POST", {
        expectedUpdatedAt: form.updatedAt,
        sectionId: section.id,
        orderedFieldIds: ordered,
      }));
      setForm((current) => mergePortalTopLevelDraft(next, current));
    } catch (error) {
      toast(error instanceof Error ? error.message : "The question order could not be saved", { kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  function closeCustomField() {
    requestGuardedEditorClose({
      busy,
      dirty: customFieldDraftDirty,
      runGuarded,
      close: () => { setCustomOpen(false); setCustomLabel(""); setCustomType("text"); },
    });
  }

  return <div className="builder-wrap">
    <header className="builder-header">
      <div className="builder-title">
        <Link className="icon-button" aria-label="Back to portal forms" href={`/events/${event.id}/tasks/forms`}><ArrowLeft size={18} /></Link>
        <div>
          <div><h1>{form.internalName}</h1><span className={`status-badge status-${targetType}`}><i />{targetType === "submission" ? "Submission" : "Contact"}</span></div>
          <span>Version {form.currentVersion} · <i className={dirty ? "saving" : "saved"}>{dirty ? "Unsaved changes" : "All changes saved"}</i></span>
        </div>
      </div>
      <div className="builder-actions">
        <Button disabled={busy} onClick={() => void saveTopLevel()}><Save size={16} /> {busy ? "Saving…" : "Save"}</Button>
      </div>
    </header>
    <div className="builder-canvas">
      <section className="builder-step">
        <header><div className="step-number">1</div><div><h2>Setup</h2><p>Name this form for your team and speakers.</p></div></header>
        <div className="builder-card form-stack">
          <Field label="Internal form name" required hint={`${internalName.length}/255`}>
            <input required maxLength={255} value={internalName} onChange={(current) => { setInternalName(current.target.value); setDirty(true); }} />
          </Field>
          <Field label="Public title" required hint={`${externalTitle.length}/255`}>
            <input required maxLength={255} value={externalTitle} onChange={(current) => { setExternalTitle(current.target.value); setDirty(true); }} />
          </Field>
          <div className="inline-setting">
            <div><b>Edits</b><small>What this form updates — fixed at creation.</small></div>
            <span className={`status-badge status-${targetType}`}><i />{targetType === "submission" ? <><Users size={12} /> Submission</> : <><Contact2 size={12} /> Contact</>}</span>
          </div>
        </div>
      </section>

      <section className="builder-step">
        <header><div className="step-number">2</div><div><h2>Questions</h2><p>Add fields from the standard library, or a custom question with no system mapping.</p></div></header>
        <div className="builder-card field-section">
          <div className="section-heading"><div><h3>Form questions</h3><p>{section?.fields.length ?? 0} live questions</p></div></div>
          <div className="builder-fields">
            {section?.fields.map((field, index) => (
              <div className={selectedFieldId === field.id ? "selected builder-field-row" : "builder-field-row"} key={field.id}>
                <button className="field-row-main" onClick={() => setSelectedFieldId(field.id)}>
                  <span className="field-type-icon">{typeIcon(field.fieldType)}</span>
                  <div><b>{field.label}{field.required && <em>*</em>}</b><small>{field.mapsTo ? `Maps to ${field.mapsTo}` : "Custom question"}</small></div>
                </button>
                <button className="icon-button" aria-label={`Move ${field.label} up`} disabled={index === 0 || busy} onClick={() => void moveField(field.id, -1)}><ArrowUp size={14} /></button>
                <button className="icon-button" aria-label={`Move ${field.label} down`} disabled={index === (section?.fields.length ?? 0) - 1 || busy} onClick={() => void moveField(field.id, 1)}><ArrowDown size={14} /></button>
              </div>
            ))}
          </div>
          <Button variant="ghost" className="add-question" disabled={busy} onClick={() => setLibraryOpen(true)}><Plus size={16} /> Add field</Button>
        </div>
      </section>

      <section className="builder-step">
        <header>
          <div><h2>Settings</h2><p>Confirmation email — collapsed by default.</p></div>
        </header>
        <Button variant="secondary" onClick={() => setSettingsOpen((current) => !current)}>{settingsOpen ? "Hide settings" : "Show settings"}</Button>
        {settingsOpen && <NotificationsStep form={form} onChange={(patch) => { setForm((current) => ({ ...current, ...patch }) as BuilderForm); setDirty(true); }} />}
      </section>
    </div>

    {/* Add field: standard library (filtered to this form's target type) + a "Create Field" escape hatch to M12's generic committed-type picker. */}
    <Modal open={libraryOpen} onClose={() => setLibraryOpen(false)} title="Add a field" description={`Fields for a ${targetType === "submission" ? "submission" : "contact"} form.`} footer={<Button variant="secondary" onClick={() => { setLibraryOpen(false); setCustomOpen(true); }}>Create custom field instead</Button>}>
      <div className="form-stack">
        <Field label="Search"><input autoFocus placeholder="Search the field library" value={librarySearch} onChange={(current) => setLibrarySearch(current.target.value)} /></Field>
        <div className="builder-fields">
          {library.map((item) => (
            <button key={item.libraryKey} className="field-row-main" disabled={busy} onClick={() => void addStandardField(item)}>
              <span className="field-type-icon">{typeIcon(item.fieldType)}</span>
              <div><b>{item.label}</b><small>{committedTypeLabel(item.fieldType)}</small></div>
            </button>
          ))}
          {library.length === 0 && <p>{librarySearch.trim() ? <>No library fields match &ldquo;{librarySearch}&rdquo;.</> : "All standard fields for this form have already been added."}</p>}
        </div>
      </div>
    </Modal>

    <Modal
      open={customOpen}
      onClose={closeCustomField}
      title="Create a custom field"
      description="No system mapping — answers land only in this response's own record."
      footer={<><Button variant="secondary" onClick={closeCustomField}>Cancel</Button><Button disabled={!customLabel.trim() || busy} onClick={() => void addCustomField()}>Add question</Button></>}
    >
      <div className="form-stack">
        <Field label="Question label" required><input autoFocus required value={customLabel} onChange={(current) => setCustomLabel(current.target.value)} placeholder="What would you like to ask?" /></Field>
        <Field label="Response type" group>
          <div className="type-grid">
            {COMMITTED_FIELD_TYPES.map((type) => (
              <button type="button" aria-pressed={customType === type} key={type} className={customType === type ? "active" : ""} onClick={() => setCustomType(type)}>
                <span>{typeIcon(type)}</span><div><b>{committedTypeLabel(type)}</b></div>
              </button>
            ))}
          </div>
        </Field>
      </div>
    </Modal>

    {selectedField && (
      <FieldEditModal
        field={selectedField}
        busy={busy}
        onClose={() => setSelectedFieldId(null)}
        onSave={saveField}
        onDelete={() => setPendingDelete(selectedField)}
      />
    )}
    <ConfirmDialog
      open={pendingDelete !== null}
      title={pendingDelete ? `Delete “${pendingDelete.label}”?` : "Delete question?"}
      body="This question and its draft configuration will be permanently removed."
      confirmLabel="Delete question"
      onConfirm={async () => { if (pendingDelete) await deleteField(pendingDelete); }}
      onCancel={() => setPendingDelete(null)}
    />
  </div>;
}

function FieldEditModal({ field, busy, onClose, onSave, onDelete }: {
  field: BuilderField;
  busy: boolean;
  onClose: () => void;
  onSave: (patch: { label: string; helpText: string; required: boolean; maxChars: number | null; optionLabels?: string[] }) => Promise<BuilderField | null>;
  onDelete: () => void;
}) {
  const [label, setLabel] = useState(field.label);
  const [helpText, setHelpText] = useState(field.helpText);
  const [required, setRequired] = useState(field.required);
  const [maxChars, setMaxChars] = useState(field.maxChars);
  const [optionLabels, setOptionLabels] = useState(field.options.map((option) => option.label).join("\n"));
  const acceptsMaxChars = field.fieldType === "text" || field.fieldType === "textarea" || field.fieldType === "richtext";
  const isOptions = field.fieldType === "dropdown" || field.fieldType === "multiselect";
  const dirty = editorDraftChanged(
    { label, helpText, required, maxChars, optionLabels },
    { label: field.label, helpText: field.helpText, required: field.required, maxChars: field.maxChars, optionLabels: field.options.map((option) => option.label).join("\n") },
  );
  useUnsavedWorkGuard(dirty);
  const { runGuarded } = useGuardedAction();

  async function saveDraft() {
    const saved = await onSave({
      label,
      helpText,
      required,
      maxChars: acceptsMaxChars ? maxChars : null,
      ...(isOptions ? { optionLabels: optionLabels.split("\n").map((entry) => entry.trim()).filter(Boolean) } : {}),
    });
    if (!saved) return;
    setLabel(saved.label);
    setHelpText(saved.helpText);
    setRequired(saved.required);
    setMaxChars(saved.maxChars);
    setOptionLabels(saved.options.map((option) => option.label).join("\n"));
  }

  return (
    <Modal
      open
      onClose={() => requestGuardedEditorClose({ busy, dirty, runGuarded, close: onClose })}
      title="Edit field"
      footer={<>
        {!field.locked && <Button variant="ghost" className="delete-field" disabled={busy} onClick={onDelete}><Trash2 size={15} /> Delete question</Button>}
        <Button disabled={busy || !label.trim()} onClick={() => void saveDraft()}><Save size={15} /> Save question</Button>
      </>}
    >
      <div className="form-stack">
        <Field label="Label" required><input required maxLength={255} value={label} onChange={(current) => setLabel(current.target.value)} /></Field>
        <Field label="Help text"><textarea value={helpText} onChange={(current) => setHelpText(current.target.value)} /></Field>
        {acceptsMaxChars && <Field label="Maximum characters"><input type="number" min={1} value={maxChars ?? ""} onChange={(current) => setMaxChars(current.target.value ? Number(current.target.value) : null)} /></Field>}
        {isOptions && (
          <Field label="Options" hint={field.mapsTo === "submission.level" ? "One option per line — Level is a free-text list, not linked to event data." : "One option per line."}>
            <textarea value={optionLabels} onChange={(current) => setOptionLabels(current.target.value)} />
          </Field>
        )}
        <div className="inline-setting">
          <div><b>Required</b><small>Speakers must answer this question.</small></div>
          <Switch label="Required" checked={required} onClick={() => setRequired((current) => !current)} />
        </div>
        {/* M24 §5/§7: `mapsTo` is read-only here, chosen only from the standard
            library at add-time (or left null for a custom field) — this
            builder never lets an admin type an arbitrary maps_to string. */}
        <div className="inline-setting">
          <div><b>System mapping</b><small>{field.mapsTo ?? "None — custom question"}</small></div>
          {field.locked && <LockKeyhole size={14} />}
        </div>
      </div>
    </Modal>
  );
}

function typeIcon(type: string) {
  const labels: Record<string, string> = { text: "T", textarea: "¶", richtext: "Aa", dropdown: "⌄", multiselect: "☷", email: "@", url: "↗", file: "↑" };
  return labels[type] ?? "T";
}
