"use client";

import { ArrowLeft, MessageSquare, Paperclip } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fileVersionDtoSchema, type AnswerValue, type FileVersionDTO, type FormSnapshot } from "@/shared/contracts";
import { FormFieldRenderer } from "@/features/forms/index.client";
import { FileUpload } from "@/shared/ui/app/file-upload";
import { FormUploadProvider } from "@/shared/ui/app/form-upload-context";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { readFieldErrors } from "@/shared/lib/api-client";
import { formatCode } from "@/features/submissions/index.client";
import type { MyTaskDetail } from "../server/queries";

/**
 * One task, and the one thing it asks for.
 *
 * All three modes end in the same place: a POST that the server re-authorizes
 * against `task_assignments_v`. Nothing here decides whether a completion is
 * allowed — this component decides only what to show while asking.
 */
export function TaskDetailView({
  eventId,
  eventSlug,
  timezone,
  task,
  form,
}: {
  eventId: string;
  eventSlug: string;
  timezone: string;
  task: MyTaskDetail;
  /** Present only for form-mode tasks. */
  form: { snapshot: FormSnapshot; answers: Record<string, AnswerValue> } | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Record<string, AnswerValue | undefined>>(form?.answers ?? {});
  const [uploads, setUploads] = useState<FileVersionDTO[]>(task.uploads);
  const [completed, setCompleted] = useState(task.completed);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const formPanelRef = useRef<HTMLDivElement>(null);

  const backHref = `/portal/${encodeURIComponent(eventSlug)}/tasks`;

  useEffect(() => {
    setUploads(task.uploads);
    setCompleted(task.completed);
  }, [task.completed, task.uploads]);

  async function post(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data?: Record<string, unknown> }> {
    setBusy(true);
    setFieldErrors({});
    try {
      // A dropped connection is the normal case on a phone in a conference
      // hall, so it has to read as "try again", not as a blank screen.
      const response = await fetch(`${path}?eventId=${encodeURIComponent(eventId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId: task.submissionId, ...body }),
      }).catch(() => null);
      if (!response) {
        toast("That did not reach us — check your connection and try again", { kind: "error" });
        return { ok: false };
      }
      const payload = await response.json().catch(() => null) as {
        data?: Record<string, unknown>;
        error?: { message?: string; data?: { fieldErrors?: Record<string, string> } };
      } | null;
      if (!response.ok) {
        // Field errors belong beside their questions; anything else is a
        // sentence, not a form state.
        const errors = readFieldErrors(payload?.error);
        if (errors) {
          setFieldErrors(errors);
          window.requestAnimationFrame(() => formPanelRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        }
        toast(errors ? "Some answers need fixing" : payload?.error?.message ?? "That did not go through", { kind: "error" });
        return { ok: false };
      }
      return payload?.data ? { ok: true, data: payload.data } : { ok: true };
    } finally {
      setBusy(false);
    }
  }

  async function complete(body: Record<string, unknown> = {}) {
    if (!(await post(`/api/internal/portal/tasks/${task.taskId}/complete`, body)).ok) return;
    toast("Task complete — your organizer can see it now");
    router.push(backHref);
    router.refresh();
  }

  function changeAnswer(fieldId: string, value: AnswerValue | undefined) {
    setAnswers((current) => ({ ...current, [fieldId]: value }));
    setFieldErrors((current) => {
      if (!current[fieldId]) return current;
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  }

  async function attach(fileId: string): Promise<boolean> {
    const result = await post(`/api/internal/portal/tasks/${task.taskId}/upload`, { fileAssetId: fileId });
    if (!result.ok) return false;
    const upload = fileVersionDtoSchema.safeParse(result.data?.upload);
    if (!upload.success) {
      toast("File received, but the new version could not be displayed — refresh and try again", { kind: "error" });
      router.refresh();
      return false;
    }
    setUploads((current) => [upload.data, ...current.filter((entry) => entry.fileUploadId !== upload.data.fileUploadId)]);
    setCompleted(true);
    toast("File received — task complete");
    router.refresh();
    return true;
  }

  /** M52: a comment on this deliverable slot. Same server round trip pattern
   * as `attach` — the server route is the one source of truth for the thread,
   * so a successful post just re-fetches the task rather than appending a
   * client-guessed row. */
  async function sendComment() {
    const body = commentDraft.trim();
    if (!body) return;
    setCommentBusy(true);
    try {
      const response = await fetch(`/api/internal/portal/tasks/${task.taskId}/comments?eventId=${encodeURIComponent(eventId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ submissionId: task.submissionId, body }),
      }).catch(() => null);
      if (!response?.ok) {
        toast("That comment did not go through — try again", { kind: "error" });
        return;
      }
      setCommentDraft("");
      router.refresh();
    } finally {
      setCommentBusy(false);
    }
  }

  return (
    <div className="portal-container portal-page">
      <Link className="portal-back" href={backHref}><ArrowLeft size={15} /> All tasks</Link>

      <header className="portal-page-header">
        <div className="portal-task-meta">
          <StatusBadge value={completed ? "complete" : task.completionMode} />
          {task.overdue && <StatusBadge value="overdue" />}
          {task.dueAt && <span className="due-label">Due <TzTime instant={task.dueAt} tz={timezone} style="long" /></span>}
        </div>
        <h1>{task.taskName}</h1>
        {task.submissionCode !== null && <p>{formatCode(task.submissionCode)} · {task.submissionTitle}</p>}
      </header>

      {task.descriptionHtml && <div className="portal-panel"><RichTextView html={task.descriptionHtml} /></div>}

      {task.completionMode === "manual" && (
        <div className="portal-panel">
          {completed ? (
            <p className="portal-note">
              Marked complete <TzTime instant={task.completedAt ?? ""} tz={timezone} style="long" />.
            </p>
          ) : (
            <Button disabled={busy} onClick={() => complete()}>{busy ? "Saving…" : "Mark as complete"}</Button>
          )}
        </div>
      )}

      {task.completionMode === "file_request" && task.fileRequest && (
        <div className="portal-panel">
          {task.fileRequest.instructionsHtml && <RichTextView html={task.fileRequest.instructionsHtml} />}
          <p className="portal-note">
            {task.fileRequest.acceptedExtensions.join(", ")} · up to {task.fileRequest.maxSizeMb} MB
          </p>
          <FileUpload
            eventId={eventId}
            kind="upload"
            fileRequestId={task.fileRequest.id}
            maxSizeMb={task.fileRequest.maxSizeMb}
            accept={task.fileRequest.acceptedExtensions.map((extension) => `.${extension}`).join(",")}
            label={uploads.length > 0 ? "Upload a newer version" : "Choose a file"}
            onUploaded={(fileId) => attach(fileId)}
          />
          {uploads.length > 0 && (
            <ul className="portal-uploads" aria-live="polite">
              {uploads.map((upload) => (
                <li key={upload.fileUploadId}>
                  <Paperclip size={15} />
                  <span>{upload.filename} <small>v{upload.version}</small></span>
                  <TzTime instant={upload.uploadedAt} tz={timezone} style="date" />
                  {/* Nothing is deleted; `isLatest` is server-derived (M52). */}
                  {upload.isLatest && <em>Latest</em>}
                </li>
              ))}
            </ul>
          )}

          <section className="drawer-content" style={{ padding: "16px 0 0" }}>
            <h3><MessageSquare size={12} style={{ verticalAlign: "-2px", marginRight: 6 }} />Comments</h3>
            {task.comments.length === 0
              ? <p className="portal-note">No comments yet — ask a question about this deliverable here.</p>
              : task.comments.map((comment) => (
                <div className="review-comment" key={comment.id}>
                  <header>
                    <span>{comment.authorName.slice(0, 2).toUpperCase()}</span>
                    <b>{comment.authorName}</b>
                    <em>{comment.authorRole === "organizer" ? "Organizer" : "You"}</em>
                  </header>
                  <p>{comment.body}</p>
                </div>
              ))}
            <div className="form-stack" style={{ marginTop: 12 }}>
              <textarea
                aria-label="Comment for organizers"
                rows={2}
                value={commentDraft}
                onChange={(event) => setCommentDraft(event.target.value)}
                placeholder="Add a comment for the organizers…"
                maxLength={5000}
              />
              <Button size="sm" disabled={commentBusy || commentDraft.trim().length === 0} onClick={() => void sendComment()}>
                {commentBusy ? "Sending…" : "Send"}
              </Button>
            </div>
          </section>
        </div>
      )}

      {task.completionMode === "form" && !form && (
        <div className="portal-panel">
          <p className="portal-note" role="alert">
            This task&rsquo;s form is not ready yet. Nothing is needed from you until the organizers publish it.
          </p>
        </div>
      )}

      {task.completionMode === "form" && form && (
        <div ref={formPanelRef} className="portal-panel">
          {/* A file question inside the renderer reads its event scope from this
              provider; without it the field renders "File uploads are
              unavailable here" and a required upload makes the task impossible
              to finish from the portal. */}
          <FormUploadProvider eventId={eventId}>
            <FormFieldRenderer
              snapshot={form.snapshot}
              answers={answers}
              onChange={changeAnswer}
              mode="edit"
              errors={fieldErrors}
            />
          </FormUploadProvider>
          <Button disabled={busy} onClick={() => complete({ answers })}>
            {busy ? "Saving…" : completed ? "Save changes" : "Submit & complete"}
          </Button>
        </div>
      )}
    </div>
  );
}
