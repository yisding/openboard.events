"use client";

import { useEffect, useState } from "react";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { Button, Field, Modal } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import type { AdminTaskDTO, FileRequestDTO, FormOption } from "../server/queries";

export type TaskDraft = {
  id?: string;
  name: string;
  descriptionHtml: string;
  targetType: "contact" | "submission";
  completionMode: "manual" | "form" | "file_request";
  formId: string | null;
  fileRequestId: string | null;
  dueAt: string | null;
  isActive: boolean;
};

/**
 * `Field.hint` is `hint?: string` under `exactOptionalPropertyTypes` — the prop
 * may be omitted, but never explicitly set to `undefined`. Spreading this is
 * how a possibly-absent hint gets passed without violating that.
 */
function hintProp(hint: string | undefined): { hint: string } | Record<string, never> {
  return hint ? { hint } : {};
}

function draftFromTask(task: AdminTaskDTO | null): TaskDraft {
  if (!task) {
    return {
      name: "", descriptionHtml: "", targetType: "contact", completionMode: "manual",
      formId: null, fileRequestId: null, dueAt: null, isActive: true,
    };
  }
  return {
    id: task.id,
    name: task.name,
    descriptionHtml: task.descriptionHtml,
    targetType: task.targetType,
    completionMode: task.completionMode,
    formId: task.formId,
    fileRequestId: task.fileRequestId,
    // The picker only ever shows a date; trimming here is what stops a
    // previously-set time-of-day from round-tripping into the input.
    dueAt: task.dueAt ? task.dueAt.slice(0, 10) : null,
    isActive: task.isActive,
  };
}

/**
 * Create/edit a task. `locked` disables the target/mode/attachment fields once
 * the task has completions — the same mode-lock the server re-checks on every
 * save (analysis trap #4), mirrored here only so the organizer sees *why* the
 * fields are frozen rather than getting a 400 after filling the form out.
 */
export function TaskEditor({
  eventId,
  open,
  task,
  locked,
  forms,
  fileRequests,
  onClose,
  onSaved,
}: {
  eventId: string;
  open: boolean;
  task: AdminTaskDTO | null;
  locked: boolean;
  forms: FormOption[];
  fileRequests: FileRequestDTO[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<TaskDraft>(() => draftFromTask(task));
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setDraft(draftFromTask(task));
      setFieldErrors({});
    }
  }, [open, task]);

  const availableFileRequests = fileRequests.filter((request) => request.targetType === draft.targetType);

  function setMode(mode: TaskDraft["completionMode"]) {
    setDraft((current) => ({
      ...current,
      completionMode: mode,
      formId: mode === "form" ? current.formId : null,
      fileRequestId: mode === "file_request" ? current.fileRequestId : null,
    }));
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setFieldErrors({});
    try {
      const response = await fetch(draft.id ? `/api/internal/tasks/${draft.id}?eventId=${eventId}` : `/api/internal/tasks?eventId=${eventId}`, {
        method: draft.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          descriptionHtml: draft.descriptionHtml,
          targetType: draft.targetType,
          completionMode: draft.completionMode,
          formId: draft.formId,
          fileRequestId: draft.fileRequestId,
          dueAt: draft.dueAt,
          isActive: draft.isActive,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: { message?: string; fieldErrors?: Record<string, string> } } | null;
      if (!response.ok) {
        setFieldErrors(payload?.error?.fieldErrors ?? {});
        toast(payload?.error?.message ?? "That task could not be saved");
        return;
      }
      toast(draft.id ? "Task updated" : "Task created");
      onSaved();
    } catch {
      toast("That task could not be saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={draft.id ? "Edit task" : "Create a task"}
      description="Assign once to accepted speakers or per accepted submission."
      wide
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={!draft.name.trim() || saving} onClick={save}>{draft.id ? "Save changes" : "Create task"}</Button>
      </>}
    >
      <div className="form-stack">
        <Field label="Task name" required {...hintProp(fieldErrors.name)}>
          <input autoFocus value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="e.g. Upload final slides" />
        </Field>

        <Field label="Description">
          <RichTextEditor value={draft.descriptionHtml} onChange={(html) => setDraft((current) => ({ ...current, descriptionHtml: html }))} placeholder="What should speakers do?" />
        </Field>

        <div className="form-grid">
          <Field label="Target" {...hintProp(locked ? "This task has completions — create a new task to change who it targets." : undefined)}>
            <select
              value={draft.targetType}
              disabled={locked}
              onChange={(event) => setDraft((current) => ({ ...current, targetType: event.target.value as TaskDraft["targetType"], fileRequestId: null }))}
            >
              <option value="contact">Accepted speakers</option>
              <option value="submission">Accepted submissions</option>
            </select>
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={draft.dueAt ?? ""}
              onChange={(event) => setDraft((current) => ({ ...current, dueAt: event.target.value || null }))}
            />
          </Field>
        </div>

        <Field label="Completion mode" {...hintProp(fieldErrors.completionMode)}>
          <div className="choice-cards compact">
            {(["manual", "form", "file_request"] as const).map((mode) => (
              <button type="button" key={mode} disabled={locked} className={draft.completionMode === mode ? "active" : ""} onClick={() => setMode(mode)}>
                <b>{mode === "file_request" ? "File request" : mode === "form" ? "Form" : "Manual"}</b>
                <small>{mode === "manual" ? "One-click confirmation" : mode === "form" ? "Structured questions" : "Document upload"}</small>
              </button>
            ))}
          </div>
        </Field>

        {draft.completionMode === "form" && (
          <Field label="Form" required {...hintProp(forms.length === 0 ? "No portal forms yet — create one first." : undefined)}>
            <select disabled={locked} value={draft.formId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, formId: event.target.value || null }))}>
              <option value="">Choose a form…</option>
              {forms.map((form) => <option key={form.id} value={form.id}>{form.internalName}</option>)}
            </select>
          </Field>
        )}

        {draft.completionMode === "file_request" && (
          <Field label="File request" required {...hintProp(availableFileRequests.length === 0 ? "No matching file requests yet — create one first." : undefined)}>
            <select disabled={locked} value={draft.fileRequestId ?? ""} onChange={(event) => setDraft((current) => ({ ...current, fileRequestId: event.target.value || null }))}>
              <option value="">Choose a file request…</option>
              {availableFileRequests.map((request) => <option key={request.id} value={request.id}>{request.title}</option>)}
            </select>
          </Field>
        )}

        <label className="inline-setting">
          <div><b>Active</b><small>Inactive tasks stop assigning to new speakers and drop off the portal.</small></div>
          <button type="button" className={`switch ${draft.isActive ? "on" : ""}`} onClick={() => setDraft((current) => ({ ...current, isActive: !current.isActive }))}><i /></button>
        </label>
      </div>
    </Modal>
  );
}
