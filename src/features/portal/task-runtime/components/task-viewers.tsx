"use client";

import { Paperclip } from "lucide-react";
import type { AnswerValue } from "@/shared/contracts";
import { PrivateFileLink } from "@/shared/ui/app/private-file-link";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Dash } from "@/shared/ui/app/dash";
import type { TaskCompletionRow } from "../server/queries";

/**
 * The organizer's read-only side of a task: who finished it and what they sent.
 * Two components rather than one, because the tasks admin shows them in
 * different places and a file task has no answers to render.
 *
 * Answers are keyed by field id and labelled from the version they were written
 * against, so a question renamed — or deleted — later still reads the way the
 * speaker saw it.
 */

function answerText(value: AnswerValue): string {
  switch (value.t) {
    case "s": return value.v.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    case "opt": return value.v;
    case "opts": return value.v.join(", ");
    case "n": return String(value.v);
    case "d": return value.v;
    case "file": return value.v;
  }
}

function Who({ row, timezone }: { row: TaskCompletionRow; timezone: string }) {
  return (
    <header>
      <b>{row.contactName}</b>
      {row.submissionCode !== null && <span> · SESS-{row.submissionCode}</span>}
      <span> · <TzTime instant={row.completedAt} tz={timezone} style="long" /></span>
    </header>
  );
}

export function TaskResponseViewer({ rows, timezone }: { rows: TaskCompletionRow[]; timezone: string }) {
  const responses = rows.filter((row) => row.completedVia === "form_response");
  if (responses.length === 0) return <p className="portal-note">Nobody has filled this form in yet.</p>;
  return (
    <div className="task-completions">
      {responses.map((row) => (
        <article key={`${row.contactId}:${row.submissionId ?? ""}`}>
          <Who row={row} timezone={timezone} />
          <dl>
            {row.answers.map((answer) => (
              <div key={answer.fieldId}>
                <dt>{answer.label}</dt>
                <dd><Dash value={answerText(answer.value)}><span>{answerText(answer.value)}</span></Dash></dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </div>
  );
}

export function TaskUploadViewer({ rows, timezone }: { rows: TaskCompletionRow[]; timezone: string }) {
  const uploads = rows.filter((row) => row.completedVia === "file_upload" && row.file);
  if (uploads.length === 0) return <p className="portal-note">Nobody has uploaded a file yet.</p>;
  return (
    <div className="task-completions">
      {uploads.map((row) => (
        <article key={`${row.contactId}:${row.submissionId ?? ""}`}>
          <Who row={row} timezone={timezone} />
          <p>
            <Paperclip size={15} />
            {/* Uploads are private by policy, so the link is presigned on click
                rather than a public /f/ path. */}
            <PrivateFileLink fileId={row.file?.fileAssetId ?? ""}>{row.file?.filename ?? "Uploaded file"}</PrivateFileLink>
            <small>{Math.max(1, Math.round((row.file?.sizeBytes ?? 0) / 1024))} KB</small>
          </p>
        </article>
      ))}
    </div>
  );
}
