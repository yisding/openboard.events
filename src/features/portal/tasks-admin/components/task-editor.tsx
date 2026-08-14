"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DateTimePicker } from "@/shared/ui/app/datetime-picker";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { editorDraftChanged, requestGuardedEditorClose } from "@/shared/ui/app/modal-editor-guard";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Field, Modal, Select, Switch } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { taskDtoSchema, type TaskDTO } from "@/shared/contracts";
import { createStableCreateRequestId } from "@/shared/lib/stable-create-request-id";
import { endOfDayInTz, eventDayKey } from "@/shared/lib/time";
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

const COMPLETION_MODES = ["manual", "form", "file_request"] as const;

export function withoutFieldError(errors: Record<string, string>, field: string): Record<string, string> {
  if (!errors[field]) return errors;
  const next = { ...errors };
  delete next[field];
  return next;
}

/**
 * `Field.hint` is `hint?: string` under `exactOptionalPropertyTypes` — the prop
 * may be omitted, but never explicitly set to `undefined`. Spreading this is
 * how a possibly-absent hint gets passed without violating that.
 */
function hintProp(hint: string | undefined): { hint: string } | Record<string, never> {
  return hint ? { hint } : {};
}

export function draftFromTask(task: TaskDTO | null, timezone: string, duplicate = false): TaskDraft {
  if (!task) {
    return {
      name: "", descriptionHtml: "", targetType: "contact", completionMode: "manual",
      formId: null, fileRequestId: null, dueAt: null, isActive: true,
    };
  }
  const duplicateSuffix = " (copy)";
  return {
    ...(duplicate ? {} : { id: task.id }),
    name: duplicate ? `${task.name.slice(0, 255 - duplicateSuffix.length)}${duplicateSuffix}` : task.name,
    descriptionHtml: task.descriptionHtml,
    targetType: task.targetType,
    completionMode: task.completionMode,
    formId: task.formId,
    fileRequestId: task.fileRequestId,
    // `dueAt` is a UTC instant at end-of-day *in the event zone*; for negative-offset
    // zones that instant falls on the next UTC date, so slicing the raw ISO string
    // would show (and re-save) the day after. Format the day in the event zone.
    dueAt: task.dueAt ? eventDayKey(task.dueAt, timezone) : null,
    isActive: duplicate ? false : task.isActive,
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
  timezone,
  open,
  task,
  duplicateOf,
  locked,
  forms,
  fileRequests,
  onClose,
  onSaved,
}: {
  eventId: string;
  timezone: string;
  open: boolean;
  task: AdminTaskDTO | null;
  duplicateOf: AdminTaskDTO | null;
  locked: boolean;
  forms: FormOption[];
  fileRequests: FileRequestDTO[];
  onClose: () => void;
  onSaved: (saved: TaskDTO) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const duplicating = duplicateOf !== null;
  const initialDraft = draftFromTask(task ?? duplicateOf, timezone, duplicating);
  const [draft, setDraft] = useState<TaskDraft>(initialDraft);
  const [baseline, setBaseline] = useState<TaskDraft>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [stale, setStale] = useState(false);
  const [confirmingLoadLatest, setConfirmingLoadLatest] = useState(false);
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(task?.updatedAt ?? null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const editorRef = useRef<HTMLDivElement>(null);
  const staleRef = useRef<HTMLDivElement>(null);
  const createRequestId = useRef(createStableCreateRequestId());
  const { runGuarded } = useGuardedAction();
  const dirty = open && editorDraftChanged(draft, baseline);
  useUnsavedWorkGuard(dirty);

  useEffect(() => {
    if (!open) {
      createRequestId.current.reset();
      return;
    }
    if (task) createRequestId.current.reset();
    else createRequestId.current.begin();
    const nextDraft = draftFromTask(task ?? duplicateOf, timezone, duplicating);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setExpectedUpdatedAt(task?.updatedAt ?? null);
    setStale(false);
    setConfirmingLoadLatest(false);
    setFieldErrors({});
  }, [duplicateOf, duplicating, open, task, timezone]);

  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return;
    editorRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [fieldErrors]);

  useEffect(() => {
    if (!stale) return;
    window.requestAnimationFrame(() => staleRef.current?.focus());
  }, [stale]);

  const availableFileRequests = fileRequests.filter((request) => request.targetType === draft.targetType);

  function clearFieldError(field: string) {
    setFieldErrors((current) => withoutFieldError(current, field));
  }

  function discardEditor() {
    createRequestId.current.reset();
    onClose();
  }

  function closeEditor() {
    requestGuardedEditorClose({ busy: saving || loadingLatest, dirty, runGuarded, close: discardEditor });
  }

  function setMode(mode: TaskDraft["completionMode"]) {
    setDraft((current) => ({
      ...current,
      completionMode: mode,
      formId: mode === "form" ? current.formId : null,
      fileRequestId: mode === "file_request" ? current.fileRequestId : null,
    }));
    clearFieldError("completionMode");
    clearFieldError("formId");
    clearFieldError("fileRequestId");
  }

  function onModeKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    if (delta === 0) return;
    event.preventDefault();
    const nextIndex = (index + delta + COMPLETION_MODES.length) % COMPLETION_MODES.length;
    const next = COMPLETION_MODES[nextIndex];
    if (!next) return;
    const group = event.currentTarget.parentElement;
    setMode(next);
    window.requestAnimationFrame(() => group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]?.focus());
  }

  async function save() {
    if (saving || loadingLatest || stale) return;
    setSaving(true);
    setFieldErrors({});
    try {
      const response = await fetch(draft.id ? `/api/internal/tasks/${draft.id}?eventId=${eventId}` : `/api/internal/tasks?eventId=${eventId}`, {
        method: draft.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createRequestId.current.payload(draft.id, {
          name: draft.name,
          descriptionHtml: draft.descriptionHtml,
          targetType: draft.targetType,
          completionMode: draft.completionMode,
          formId: draft.formId,
          fileRequestId: draft.fileRequestId,
          dueAt: draft.dueAt,
          ...(draft.id && expectedUpdatedAt ? { expectedUpdatedAt } : {}),
          // A duplicate's first save is always an inactive draft. The switch is
          // disabled below as the visible guard; this payload rule is the
          // backstop that prevents stale client state from creating fan-out.
          isActive: duplicating ? false : draft.isActive,
        })),
      });
      const payload = await response.json().catch(() => null) as { data?: unknown; error?: { code?: string; message?: string; fieldErrors?: Record<string, string> } } | null;
      const saved = taskDtoSchema.safeParse(payload?.data);
      if (payload?.error?.code === "STALE_WRITE") {
        setStale(true);
        toast(payload.error.message ?? "This task changed since you opened it", { kind: "error" });
        return;
      }
      if (!response.ok || !saved.success) {
        setFieldErrors(payload?.error?.fieldErrors ?? {});
        toast(payload?.error?.message ?? "That task could not be saved", { kind: "error" });
        return;
      }
      toast(draft.id ? "Task updated" : duplicating ? "Inactive task copy created" : "Task created");
      setBaseline(draft);
      setExpectedUpdatedAt(saved.data.updatedAt);
      await onSaved(saved.data);
      createRequestId.current.reset();
    } catch {
      toast("That task could not be saved", { kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function loadLatest() {
    if (!draft.id || loadingLatest) return;
    setLoadingLatest(true);
    try {
      const response = await fetch(`/api/internal/tasks/${draft.id}?eventId=${eventId}`);
      const payload = await response.json().catch(() => null) as { data?: { task?: unknown }; error?: { message?: string } } | null;
      const latest = taskDtoSchema.safeParse(payload?.data?.task);
      if (!response.ok || !latest.success) {
        toast(payload?.error?.message ?? "The latest task could not be loaded", { kind: "error" });
        return;
      }
      const nextDraft = draftFromTask(latest.data, timezone);
      setDraft(nextDraft);
      setBaseline(nextDraft);
      setExpectedUpdatedAt(latest.data.updatedAt);
      setFieldErrors({});
      setStale(false);
      toast("Latest task loaded");
    } catch {
      toast("The latest task could not be loaded", { kind: "error" });
    } finally {
      setLoadingLatest(false);
      setConfirmingLoadLatest(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={closeEditor}
        title={draft.id ? "Edit task" : duplicating ? "Duplicate task" : "Create a task"}
        description={duplicating
          ? "Review the copied setup. The new task will stay inactive until you deliberately activate it."
          : "Assign once to accepted speakers or per accepted submission."}
        wide
        footer={<>
          <Button variant="secondary" onClick={closeEditor} disabled={saving || loadingLatest}>Cancel</Button>
          <Button disabled={!draft.name.trim() || saving || loadingLatest || stale} onClick={save}>{saving ? "Saving…" : draft.id ? "Save changes" : duplicating ? "Create inactive copy" : "Create task"}</Button>
        </>}
      >
        {stale && (
          <div ref={staleRef} className="notify-bar" role="alert" tabIndex={-1}>
            <div>
              <p><b>This task changed since you opened it.</b></p>
              <small>Your draft is still here. Load the latest task only when you are ready to replace it.</small>
            </div>
            <Button variant="secondary" disabled={saving || loadingLatest} onClick={() => setConfirmingLoadLatest(true)}>
              {loadingLatest ? "Loading…" : "Load latest"}
            </Button>
          </div>
        )}
        <div ref={editorRef} className="form-stack" inert={saving || loadingLatest || undefined} aria-busy={saving || loadingLatest || undefined}>
        <Field label="Task name" required error={fieldErrors.name} errorId="task-name-error">
          <input required aria-invalid={Boolean(fieldErrors.name) || undefined} aria-describedby={fieldErrors.name ? "task-name-error" : undefined} value={draft.name} onChange={(event) => { setDraft((current) => ({ ...current, name: event.target.value })); clearFieldError("name"); }} placeholder="e.g. Upload final slides" />
        </Field>

        <Field label="Description" error={fieldErrors.descriptionHtml} errorId="task-description-error">
          <RichTextEditor ariaLabel="Task description" ariaInvalid={Boolean(fieldErrors.descriptionHtml)} {...(fieldErrors.descriptionHtml ? { ariaDescribedBy: "task-description-error" } : {})} value={draft.descriptionHtml} onChange={(html) => { setDraft((current) => ({ ...current, descriptionHtml: html })); clearFieldError("descriptionHtml"); }} placeholder="What should speakers do?" />
        </Field>

        <div className="form-grid">
          <Field label="Target" error={fieldErrors.targetType} errorId="task-target-error" {...hintProp(locked ? "This task has completions — create a new task to change who it targets." : undefined)}>
            <Select
              aria-invalid={Boolean(fieldErrors.targetType) || undefined}
              aria-describedby={fieldErrors.targetType ? "task-target-error" : undefined}
              value={draft.targetType}
              disabled={locked}
              onChange={(event) => { setDraft((current) => ({ ...current, targetType: event.target.value as TaskDraft["targetType"], fileRequestId: null })); clearFieldError("targetType"); clearFieldError("fileRequestId"); }}
            >
              <option value="contact">Accepted speakers</option>
              <option value="submission">Accepted submissions</option>
            </Select>
          </Field>
          <Field label="Due date" error={fieldErrors.dueAt} errorId="task-due-date-error">
            {/* The draft carries the day key the contract wants; the picker speaks
                instants. `endOfDayInTz`/`eventDayKey` are exact inverses over a day
                key, so the round trip through the control cannot shift the day. */}
            <DateTimePicker
              mode="date"
              tz={timezone}
              invalid={Boolean(fieldErrors.dueAt)}
              {...(fieldErrors.dueAt ? { ariaDescribedBy: "task-due-date-error" } : {})}
              value={draft.dueAt ? endOfDayInTz(draft.dueAt, timezone).toISOString() : null}
              onChange={(next) => { setDraft((current) => ({ ...current, dueAt: next ? eventDayKey(next, timezone) : null })); clearFieldError("dueAt"); }}
            />
          </Field>
        </div>

        <Field label="Completion mode" group radioGroup error={fieldErrors.completionMode} errorId="task-completion-mode-error">
          <div className="choice-cards compact">
            {COMPLETION_MODES.map((mode, index) => (
              <button type="button" role="radio" aria-checked={draft.completionMode === mode} tabIndex={draft.completionMode === mode ? 0 : -1} key={mode} disabled={locked} className={draft.completionMode === mode ? "active" : ""} onKeyDown={(event) => onModeKeyDown(event, index)} onClick={() => setMode(mode)}>
                <b>{mode === "file_request" ? "File request" : mode === "form" ? "Form" : "Manual"}</b>
                <small>{mode === "manual" ? "One-click confirmation" : mode === "form" ? "Structured questions" : "Document upload"}</small>
              </button>
            ))}
          </div>
        </Field>

        {draft.completionMode === "form" && (
          <Field label="Form" required error={fieldErrors.formId} errorId="task-form-error" {...hintProp(forms.length === 0 ? "No portal forms yet — create one first." : undefined)}>
            <Select required aria-invalid={Boolean(fieldErrors.formId) || undefined} aria-describedby={fieldErrors.formId ? "task-form-error" : undefined} disabled={locked} value={draft.formId ?? ""} onChange={(event) => { setDraft((current) => ({ ...current, formId: event.target.value || null })); clearFieldError("formId"); }}>
              <option value="">Choose a form…</option>
              {forms.map((form) => <option key={form.id} value={form.id}>{form.internalName}</option>)}
            </Select>
          </Field>
        )}

        {draft.completionMode === "file_request" && (
          <Field label="File request" required error={fieldErrors.fileRequestId} errorId="task-file-request-error" {...hintProp(availableFileRequests.length === 0 ? "No matching file requests yet — create one first." : undefined)}>
            <Select required aria-invalid={Boolean(fieldErrors.fileRequestId) || undefined} aria-describedby={fieldErrors.fileRequestId ? "task-file-request-error" : undefined} disabled={locked} value={draft.fileRequestId ?? ""} onChange={(event) => { setDraft((current) => ({ ...current, fileRequestId: event.target.value || null })); clearFieldError("fileRequestId"); }}>
              <option value="">Choose a file request…</option>
              {availableFileRequests.map((request) => <option key={request.id} value={request.id}>{request.title}</option>)}
            </Select>
          </Field>
        )}

        <div className="inline-setting">
          <div><b>Active</b><small>{duplicating ? "Copies start inactive. Save this draft, then activate it when you are ready to assign speakers." : "Inactive tasks stop assigning to new speakers and drop off the portal."}</small></div>
          <Switch label="Active" checked={draft.isActive} disabled={duplicating} onClick={() => setDraft((current) => ({ ...current, isActive: !current.isActive }))} />
        </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmingLoadLatest}
        title="Load the latest task?"
        body="Your unsaved task changes will be replaced by the latest saved version. This cannot be undone."
        confirmLabel="Load latest"
        variant="stale"
        onConfirm={loadLatest}
        onCancel={() => setConfirmingLoadLatest(false)}
      />
    </>
  );
}
