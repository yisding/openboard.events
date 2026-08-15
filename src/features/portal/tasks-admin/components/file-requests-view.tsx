"use client";

import { useRef, useState } from "react";
import { FileText, Plus, Upload } from "lucide-react";
import { RichTextEditor } from "@/shared/ui/app/rich-text-editor-lazy";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { editorDraftChanged, requestGuardedEditorClose } from "@/shared/ui/app/modal-editor-guard";
import { Button, EmptyState, Field, Modal } from "@/shared/ui/ui-kit";
import { useGuardedAction, useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { useToast } from "@/shared/ui/toast";
import { createStableCreateRequestId } from "@/shared/lib/stable-create-request-id";
import { DEFAULT_ACCEPTED_EXTENSIONS, FILE_REQUEST_MAX_SIZE_MB } from "../constants";
import type { FileRequestDTO } from "../server/queries";
import { taskMutation } from "./task-mutation";

type Draft = {
  id?: string;
  title: string;
  targetType: "contact" | "submission";
  instructionsHtml: string;
  acceptedExtensions: string;
  maxSizeMb: number;
};

function draftFromRequest(request: FileRequestDTO | null): Draft {
  if (!request) {
    return { title: "", targetType: "contact", instructionsHtml: "", acceptedExtensions: DEFAULT_ACCEPTED_EXTENSIONS.join(", "), maxSizeMb: 100 };
  }
  return {
    id: request.id, title: request.title, targetType: request.targetType,
    instructionsHtml: request.instructionsHtml, acceptedExtensions: request.acceptedExtensions.join(", "), maxSizeMb: request.maxSizeMb,
  };
}

/**
 * File Requests: title/type/instructions/extensions/max size, wired to
 * `saveFileRequest`. The list itself is owned by `TasksAdminView`, not this
 * component — a request created here has to be immediately selectable in the
 * task editor's "File request" dropdown (step 9's done-when), which is only
 * true if both read the same in-memory list rather than each keeping a copy
 * that goes stale the moment the other one writes.
 */
export function FileRequestsView({
  eventId,
  requests,
  onChanged,
}: {
  eventId: string;
  requests: FileRequestDTO[];
  onChanged: (change: { kind: "saved"; request: FileRequestDTO } | { kind: "deleted"; id: string }) => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<FileRequestDTO | null>(null);
  const [creating, setCreating] = useState(false);
  const initialDraft = draftFromRequest(null);
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [baseline, setBaseline] = useState<Draft>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FileRequestDTO | null>(null);
  const createRequestId = useRef(createStableCreateRequestId());
  const { runGuarded } = useGuardedAction();

  const open = creating || editing !== null;
  const dirty = open && editorDraftChanged(draft, baseline);
  useUnsavedWorkGuard(dirty);

  function startCreate() {
    if (saving) return;
    createRequestId.current.reset();
    createRequestId.current.begin();
    const nextDraft = draftFromRequest(null);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setCreating(true);
  }
  function startEdit(request: FileRequestDTO) {
    if (saving) return;
    createRequestId.current.reset();
    const nextDraft = draftFromRequest(request);
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setEditing(request);
  }
  function discardEditor() {
    createRequestId.current.reset();
    setCreating(false);
    setEditing(null);
  }

  function closeEditor() {
    requestGuardedEditorClose({ busy: saving, dirty, runGuarded, close: discardEditor });
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const result = await taskMutation<FileRequestDTO>(draft.id ? `/api/internal/file-requests/${draft.id}?eventId=${eventId}` : `/api/internal/file-requests?eventId=${eventId}`, {
        method: draft.id ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createRequestId.current.payload(draft.id, {
          title: draft.title,
          targetType: draft.targetType,
          instructionsHtml: draft.instructionsHtml,
          acceptedExtensions: draft.acceptedExtensions.split(",").map((extension) => extension.trim()).filter(Boolean),
          maxSizeMb: draft.maxSizeMb,
        })),
      }, "That file request could not be saved");
      if (!result.ok) { toast(result.message, { kind: "error" }); return; }
      const saved = result.payload?.data;
      if (!saved) { toast("That file request was saved, but its response could not be read", { kind: "error" }); return; }
      toast(draft.id ? "File request updated" : "File request created");
      setBaseline(draft);
      discardEditor();
      await onChanged({ kind: "saved", request: saved });
    } finally {
      setSaving(false);
    }
  }

  async function remove(request: FileRequestDTO) {
    const result = await taskMutation(`/api/internal/file-requests/${request.id}?eventId=${eventId}`, { method: "DELETE" }, "That file request could not be deleted");
    // A RESTRICT constraint refusal reads as this friendly message, never a raw 500.
    if (!result.ok) { toast(result.message, { kind: "error" }); return; }
    toast(`${request.title} deleted`);
    setPendingDelete(null);
    await onChanged({ kind: "deleted", id: request.id });
  }

  return (
    <section className="panel">
      <header className="panel-header">
        <div><h2>File requests</h2><p>Reusable upload requests any task can point at</p></div>
        <Button size="sm" onClick={startCreate} disabled={saving}><Plus size={14} /> Add file request</Button>
      </header>

      {requests.length === 0 && (
        <EmptyState
          icon={<Upload size={20} />}
          title="No file requests yet"
          description="Create one to collect slides, headshots, or any other document from speakers."
          action={<Button onClick={startCreate} disabled={saving}>Add file request</Button>}
        />
      )}

      {requests.map((request) => (
        <article className="admin-task-row" key={request.id}>
          <span className="task-mode-icon file_request"><FileText size={18} /></span>
          <div className="admin-task-main">
            <div><h3>{request.title}</h3></div>
            <p>{request.acceptedExtensions.join(", ").toUpperCase()} · up to {request.maxSizeMb} MB</p>
            <div><span>{request.targetType === "contact" ? "Accepted speakers" : "Accepted submissions"}</span></div>
          </div>
          <span className="row-actions">
            <Button size="sm" variant="secondary" onClick={() => startEdit(request)} disabled={saving}>Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingDelete(request)} disabled={saving}>Delete</Button>
          </span>
        </article>
      ))}

      <Modal
        open={open}
        onClose={closeEditor}
        title={draft.id ? "Edit file request" : "Create a file request"}
        wide
        footer={<>
          <Button variant="secondary" onClick={closeEditor} disabled={saving}>Cancel</Button>
          <Button disabled={!draft.title.trim() || saving} onClick={save}>{saving ? "Saving…" : draft.id ? "Save changes" : "Create file request"}</Button>
        </>}
      >
        <div className="form-stack" inert={saving || undefined} aria-busy={saving || undefined}>
          <Field label="Title" required>
            <input required value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Final slides" />
          </Field>
          <Field label="Type" group>
            <div className="choice-cards compact">
              {(["contact", "submission"] as const).map((type) => (
                <button type="button" aria-pressed={draft.targetType === type} key={type} className={draft.targetType === type ? "active" : ""} onClick={() => setDraft((current) => ({ ...current, targetType: type }))}>
                  <b>{type === "contact" ? "Speakers" : "Submissions"}</b>
                  <small>{type === "contact" ? "Once per accepted speaker" : "Once per accepted submission"}</small>
                </button>
              ))}
            </div>
          </Field>
          <Field label="Instructions">
            <RichTextEditor ariaLabel="File request instructions" value={draft.instructionsHtml} onChange={(html) => setDraft((current) => ({ ...current, instructionsHtml: html }))} placeholder="What should speakers upload?" />
          </Field>
          <div className="form-grid">
            <Field label="Accepted extensions" hint="Comma separated, no dots">
              <input value={draft.acceptedExtensions} onChange={(event) => setDraft((current) => ({ ...current, acceptedExtensions: event.target.value }))} placeholder="pdf, ppt, pptx" />
            </Field>
            <Field label="Max size (MB)">
              <input type="number" min={1} max={FILE_REQUEST_MAX_SIZE_MB} value={draft.maxSizeMb} onChange={(event) => setDraft((current) => ({ ...current, maxSizeMb: Number(event.target.value) || 1 }))} />
            </Field>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete “${pendingDelete.title}”?` : "Delete file request?"}
        body={pendingDelete ? `The “${pendingDelete.title}” file request will be permanently deleted. Tasks using it must be changed to Manual first.` : "This file request will be permanently deleted."}
        confirmLabel="Delete file request"
        onConfirm={async () => { if (pendingDelete) await remove(pendingDelete); }}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
