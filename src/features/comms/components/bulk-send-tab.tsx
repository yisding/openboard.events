"use client";

import { Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  CONFIRMATION_STATUSES,
  SPEAKER_WORKFLOW_STATUSES,
  type ComposeBulkSpeakerEmailResult,
  type ConfirmationStatus,
  type ContactId,
  type EventId,
  type ResolvedSpeakerSegment,
  type SpeakerWorkflowStatus,
} from "@/shared/contracts";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { Button, Field } from "@/shared/ui/ui-kit";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useToast } from "@/shared/ui/toast";
import { chunkContactIds, mergeBulkSendResults, useComposeBulkSpeakerEmail, useResolveSpeakerSegment } from "../hooks/use-bulk-send";
import { templateVariablePaths } from "./sample-vars";
import { unknownTokensClientSide } from "./validate-client";

const KEY = "speaker_bulk_message" as const;

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function toggle<T>(set: readonly T[], value: T): T[] {
  return set.includes(value) ? set.filter((item) => item !== value) : [...set, value];
}

/**
 * M46 — "bulk segmented sends with preview." Two steps, both explicit:
 * (1) a filter resolves to an audience (`useResolveSpeakerSegment`) with
 * suppressed/unsubscribed counted out before anything is typed, and (2) the
 * unchanged M51 compose flow (`useComposeBulkSpeakerEmail`) previews one
 * recipient's merged content, then sends — never the reverse order, so an
 * organizer always sees who and what before committing.
 */
export function BulkSendTab({ eventId }: { eventId: EventId }) {
  const { toast } = useToast();
  const resolveSegment = useResolveSpeakerSegment(eventId);
  const compose = useComposeBulkSpeakerEmail(eventId);

  const [workflowStatus, setWorkflowStatus] = useState<SpeakerWorkflowStatus[]>([]);
  const [confirmationStatus, setConfirmationStatus] = useState<ConfirmationStatus[]>([]);
  const [segment, setSegment] = useState<ResolvedSpeakerSegment | null>(null);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [previewContactId, setPreviewContactId] = useState<ContactId | "">("");
  const [preview, setPreview] = useState<{ subject: string; bodyHtml: string } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [result, setResult] = useState<ComposeBulkSpeakerEmailResult | null>(null);
  const [focusTarget, setFocusTarget] = useState<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const variablePaths = useMemo(() => templateVariablePaths(KEY), []);
  const unknownTokens = useMemo(() => unknownTokensClientSide(KEY, subject, bodyHtml), [subject, bodyHtml]);
  const canCompose = segment !== null && segment.contactIds.length > 0 && subject.trim().length > 0 && bodyHtml.trim().length > 0 && unknownTokens.length === 0;

  async function onResolve() {
    setSegment(null);
    setResult(null);
    try {
      const resolved = await resolveSegment.mutateAsync({
        ...(workflowStatus.length > 0 ? { workflowStatus } : {}),
        ...(confirmationStatus.length > 0 ? { confirmationStatus } : {}),
      });
      setSegment(resolved);
      setPreviewContactId(resolved.preview[0]?.contactId ?? "");
    } catch {
      toast("Could not resolve this segment");
    }
  }

  function insertToken(path: string) {
    const token = `{{${path}}}`;
    if (focusTarget === "subject") {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? subject.length;
      setSubject(`${subject.slice(0, start)}${token}${subject.slice(end)}`);
    } else {
      const el = bodyRef.current;
      const start = el?.selectionStart ?? bodyHtml.length;
      const end = el?.selectionEnd ?? bodyHtml.length;
      setBodyHtml(`${bodyHtml.slice(0, start)}${token}${bodyHtml.slice(end)}`);
    }
  }

  async function onPreview() {
    if (!segment || !previewContactId) return;
    setPreview(null);
    try {
      // Only the previewed recipient is ever rendered — sending the full
      // segment here would trip composeBulkSpeakerEmailInputSchema's
      // 200-recipient cap for any segment resolveSpeakerSegmentIn allows
      // above that (its own ceiling is 2,000).
      const rendered = await compose.mutateAsync({
        contactIds: [previewContactId],
        subject,
        bodyHtml,
        mode: "preview",
        previewContactId,
      });
      if (rendered.preview) setPreview({ subject: rendered.preview.subject, bodyHtml: rendered.preview.bodyHtml });
    } catch {
      toast("Could not render a preview");
    }
  }

  async function onSend() {
    if (!segment) return;
    try {
      // composeBulkSpeakerEmailInputSchema caps contactIds at 200 per call
      // (a browser DataTable-selection limit), well under a resolved
      // segment's own 2,000-recipient ceiling — so a large segment goes out
      // as several compose calls, not one that would fail validation.
      const batches = chunkContactIds(segment.contactIds);
      const results = [];
      for (const contactIds of batches) {
        results.push(await compose.mutateAsync({ contactIds, subject, bodyHtml, mode: "send" }));
      }
      const sent = mergeBulkSendResults(results);
      setResult(sent);
      toast(`Queued ${sent.queued} · Skipped ${sent.skipped}${sent.errors.length > 0 ? ` · ${sent.errors.length} error(s)` : ""}`);
    } catch {
      toast("Could not send this message");
    }
  }

  return (
    <div className="bulk-send-tab">
      <section className="panel bulk-send-filters">
        <header className="panel-header"><div><h2>1. Choose a segment</h2><p>Leave a group empty to match every value for it.</p></div></header>
        <div className="form-stack bulk-send-body">
          <Field label="Roster status">
            <div className="bulk-send-checkboxes">
              {SPEAKER_WORKFLOW_STATUSES.map((status) => (
                <label key={status} className="checkbox-row">
                  <input type="checkbox" checked={workflowStatus.includes(status)} onChange={() => setWorkflowStatus((current) => toggle(current, status))} />
                  {humanize(status)}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Confirmation status">
            <div className="bulk-send-checkboxes">
              {CONFIRMATION_STATUSES.map((status) => (
                <label key={status} className="checkbox-row">
                  <input type="checkbox" checked={confirmationStatus.includes(status)} onChange={() => setConfirmationStatus((current) => toggle(current, status))} />
                  {humanize(status)}
                </label>
              ))}
            </div>
          </Field>
          <Button onClick={() => void onResolve()} disabled={resolveSegment.isPending}>{resolveSegment.isPending ? "Resolving…" : "Preview audience"}</Button>
          {segment && (
            <div className="notify-bar">
              <div>
                <span className="metric-icon accent"><Users size={18} /></span>
                <p>
                  <b>{segment.contactIds.length} recipient{segment.contactIds.length === 1 ? "" : "s"} will be emailed</b>
                  <small>
                    {segment.matchedCount} matched the segment
                    {segment.excludedSuppressedCount > 0 ? ` · ${segment.excludedSuppressedCount} suppressed` : ""}
                    {segment.excludedUnsubscribedCount > 0 ? ` · ${segment.excludedUnsubscribedCount} unsubscribed` : ""}
                    {segment.capped ? " · capped at 2,000 — send in batches for the rest" : ""}
                  </small>
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel bulk-send-compose">
        <header className="panel-header"><div><h2>2. Compose</h2><p>The same merge fields every template uses, minus submission/task/session context.</p></div></header>
        <div className="bulk-send-body">
        <div className="template-editor-grid">
          <div className="form-stack">
            <Field label="Subject">
              <input ref={subjectRef} value={subject} onFocus={() => setFocusTarget("subject")} onChange={(event) => setSubject(event.target.value)} />
            </Field>
            <Field label="Email body" hint="Plain HTML; tags like <p>, <strong>, <a href> survive sanitization on save.">
              <textarea ref={bodyRef} value={bodyHtml} onFocus={() => setFocusTarget("body")} onChange={(event) => setBodyHtml(event.target.value)} />
            </Field>
            <div className="template-vars">
              {variablePaths.map((path) => <button key={path} type="button" onClick={() => insertToken(path)}>{`{{${path}}}`}</button>)}
            </div>
            {unknownTokens.length > 0 && (
              <p className="unknown-token-warning">Unknown variable {unknownTokens.map((token) => `{{${token}}}`).join(", ")} — remove it or pick from the list above.</p>
            )}
            {segment && segment.preview.length > 0 && (
              <Field label="Preview as">
                <select value={previewContactId} onChange={(event) => setPreviewContactId(event.target.value as ContactId)}>
                  {segment.preview.map((recipient) => <option key={recipient.contactId} value={recipient.contactId}>{recipient.name} ({recipient.email})</option>)}
                </select>
              </Field>
            )}
            <div className="bulk-send-actions">
              <Button variant="secondary" onClick={() => void onPreview()} disabled={!canCompose || !previewContactId || compose.isPending}>Preview message</Button>
              <Button onClick={() => setConfirmSend(true)} disabled={!canCompose || compose.isPending}>Send to {segment?.contactIds.length ?? 0} recipient{segment?.contactIds.length === 1 ? "" : "s"}</Button>
            </div>
          </div>
          <aside className="template-editor__preview">
            <span>PREVIEW</span>
            {!preview && <p className="long-copy">Resolve a segment, write a message, then Preview message.</p>}
            {preview && <><b>{preview.subject || "(empty subject)"}</b><RichTextView html={preview.bodyHtml} /></>}
          </aside>
        </div>
        {result && (
          <div className="notify-bar">
            <div>
              <span className="metric-icon accent"><Users size={18} /></span>
              <p>
                <b>Queued {result.queued} · Skipped {result.skipped}</b>
                {result.errors.length > 0 && <small>{result.errors.length} recipient(s) could not be rendered — check the comms log for details.</small>}
              </p>
            </div>
          </div>
        )}
        </div>
      </section>

      <ConfirmDialog
        open={confirmSend}
        variant="destructive"
        title={`Send to ${segment?.contactIds.length ?? 0} recipients?`}
        body="This queues one email per recipient through the ordinary outbox — suppressed and unsubscribed addresses are rechecked at send time and skipped."
        confirmLabel="Send"
        onConfirm={async () => { await onSend(); setConfirmSend(false); }}
        onCancel={() => setConfirmSend(false)}
      />
    </div>
  );
}
