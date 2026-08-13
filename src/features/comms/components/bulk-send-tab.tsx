"use client";

import { Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  acceptedBulkSendCount,
  bulkSendResultToastOptions,
  claimBulkSendAttempt,
  completeBulkSendAttempt,
  type BulkSendAttempt,
} from "../bulk-send-attempt";
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
import { Button, Field, Select } from "@/shared/ui/ui-kit";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { useToast } from "@/shared/ui/toast";
import {
  bulkSendPreviewFingerprint,
  canSendBulkMessage,
  chunkContactIds,
  mergeBulkSendResults,
  useComposeBulkSpeakerEmail,
  useResolveSpeakerSegment,
} from "../hooks/use-bulk-send";
import { MessagePreview } from "./message-preview";
import { templateVariablePaths } from "./sample-vars";
import { unknownTokensClientSide } from "./validate-client";

const KEY = "speaker_bulk_message" as const;

export function bulkMessageDraftFingerprint(input: {
  workflowStatus: readonly SpeakerWorkflowStatus[];
  confirmationStatus: readonly ConfirmationStatus[];
  subject: string;
  bodyHtml: string;
  previewSendId?: string | null;
}): string {
  return JSON.stringify({
    workflowStatus: [...input.workflowStatus].sort(),
    confirmationStatus: [...input.confirmationStatus].sort(),
    subject: input.subject,
    bodyHtml: input.bodyHtml,
    previewSendId: input.previewSendId ?? null,
  });
}

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
  const [preview, setPreview] = useState<{ subject: string; bodyHtml: string; fingerprint: string; attempt: BulkSendAttempt } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [result, setResult] = useState<ComposeBulkSpeakerEmailResult | null>(null);
  const [focusTarget, setFocusTarget] = useState<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const resolveGeneration = useRef(0);

  const currentDraftFingerprint = useMemo(() => bulkMessageDraftFingerprint({
    workflowStatus,
    confirmationStatus,
    subject,
    bodyHtml,
    previewSendId: preview?.attempt.sendId,
  }), [bodyHtml, confirmationStatus, preview?.attempt.sendId, subject, workflowStatus]);
  const [savedDraftFingerprint, setSavedDraftFingerprint] = useState(() => bulkMessageDraftFingerprint({
    workflowStatus: [],
    confirmationStatus: [],
    subject: "",
    bodyHtml: "",
  }));
  const draftDirty = currentDraftFingerprint !== savedDraftFingerprint;
  useUnsavedWorkGuard(draftDirty);

  const variablePaths = useMemo(() => templateVariablePaths(KEY), []);
  const unknownTokens = useMemo(() => unknownTokensClientSide(KEY, subject, bodyHtml), [subject, bodyHtml]);
  const canCompose = segment !== null && segment.contactIds.length > 0 && subject.trim().length > 0 && bodyHtml.trim().length > 0 && unknownTokens.length === 0;
  const currentPreviewFingerprint = useMemo(() => bulkSendPreviewFingerprint({
    contactIds: segment?.contactIds ?? [],
    previewContactId,
    subject,
    bodyHtml,
  }), [bodyHtml, previewContactId, segment?.contactIds, subject]);
  const currentPreview = preview?.fingerprint === currentPreviewFingerprint ? preview : null;
  const canSend = canSendBulkMessage({
    canCompose,
    capped: segment?.capped ?? false,
    previewFingerprint: preview?.fingerprint ?? null,
    currentFingerprint: currentPreviewFingerprint,
  });

  function invalidateAudience() {
    resolveGeneration.current += 1;
    setSegment(null);
    setPreviewContactId("");
    setPreview(null);
    setResult(null);
    setConfirmSend(false);
  }

  function invalidateMessagePreview() {
    setPreview(null);
    setResult(null);
    setConfirmSend(false);
  }

  async function onResolve() {
    const generation = resolveGeneration.current + 1;
    resolveGeneration.current = generation;
    setSegment(null);
    setPreviewContactId("");
    setPreview(null);
    setResult(null);
    setConfirmSend(false);
    try {
      const resolved = await resolveSegment.mutateAsync({
        ...(workflowStatus.length > 0 ? { workflowStatus } : {}),
        ...(confirmationStatus.length > 0 ? { confirmationStatus } : {}),
      });
      if (resolveGeneration.current !== generation) return;
      setSegment(resolved);
      setPreviewContactId(resolved.preview[0]?.contactId ?? "");
    } catch {
      if (resolveGeneration.current !== generation) return;
      toast("Could not resolve this segment", { kind: "error" });
    }
  }

  function insertToken(path: string) {
    const token = `{{${path}}}`;
    invalidateMessagePreview();
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
    if (!segment || segment.capped || !previewContactId) return;
    const fingerprint = currentPreviewFingerprint;
    setPreview(null);
    try {
      const attempt = await claimBulkSendAttempt(window.sessionStorage, `speaker-segment:${eventId}`, fingerprint);
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
      if (rendered.preview) setPreview({
        subject: rendered.preview.subject,
        bodyHtml: rendered.preview.bodyHtml,
        fingerprint,
        attempt,
      });
    } catch {
      toast("Could not render a preview", { kind: "error" });
    }
  }

  async function onSend(): Promise<boolean> {
    if (!segment || !currentPreview || !canSend) {
      toast(segment?.capped ? "Refine the audience to 2,000 recipients or fewer" : "Preview this exact audience and message before sending");
      return false;
    }
    try {
      // composeBulkSpeakerEmailInputSchema caps contactIds at 200 per call
      // (a browser DataTable-selection limit), well under a resolved
      // segment's own 2,000-recipient ceiling — so a large segment goes out
      // as several compose calls, not one that would fail validation.
      const batches = chunkContactIds(segment.contactIds);
      const results = [];
      for (const contactIds of batches) {
        results.push(await compose.mutateAsync({ contactIds, subject, bodyHtml, mode: "send", sendId: currentPreview.attempt.sendId }));
      }
      const sent = mergeBulkSendResults(results);
      completeBulkSendAttempt(window.sessionStorage, currentPreview.attempt);
      setResult(sent);
      // Keep the completed message visible as a receipt, but it is no longer
      // an unsent draft that should block navigation.
      setSavedDraftFingerprint(bulkMessageDraftFingerprint({
        workflowStatus,
        confirmationStatus,
        subject,
        bodyHtml,
        previewSendId: null,
      }));
      // A completed attempt needs a fresh preview (and therefore a fresh
      // send id) before the organizer can intentionally send it again.
      setPreview(null);
      const accepted = acceptedBulkSendCount(sent);
      toast(
        `${accepted} accepted · ${sent.queued} newly queued${sent.alreadyQueued > 0 ? ` · ${sent.alreadyQueued} recovered from this attempt` : ""} · ${sent.skipped} skipped${sent.errors.length > 0 ? ` · ${sent.errors.length} error(s)` : ""}`,
        bulkSendResultToastOptions(sent),
      );
      return true;
    } catch {
      toast("Could not send this message", { kind: "error" });
      return false;
    }
  }

  function discardDraft() {
    resolveGeneration.current += 1;
    setWorkflowStatus([]);
    setConfirmationStatus([]);
    setSegment(null);
    setSubject("");
    setBodyHtml("");
    setPreviewContactId("");
    setPreview(null);
    setResult(null);
    setConfirmSend(false);
    setConfirmDiscard(false);
    setSavedDraftFingerprint(bulkMessageDraftFingerprint({
      workflowStatus: [],
      confirmationStatus: [],
      subject: "",
      bodyHtml: "",
    }));
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
                  <input type="checkbox" checked={workflowStatus.includes(status)} onChange={() => { invalidateAudience(); setWorkflowStatus((current) => toggle(current, status)); }} />
                  {humanize(status)}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Confirmation status">
            <div className="bulk-send-checkboxes">
              {CONFIRMATION_STATUSES.map((status) => (
                <label key={status} className="checkbox-row">
                  <input type="checkbox" checked={confirmationStatus.includes(status)} onChange={() => { invalidateAudience(); setConfirmationStatus((current) => toggle(current, status)); }} />
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
                  <b>{segment.capped ? "More than 2,000 eligible recipients" : `${segment.contactIds.length} recipient${segment.contactIds.length === 1 ? "" : "s"} will be emailed`}</b>
                  <small>
                    {segment.matchedCount} matched the segment
                    {segment.excludedSuppressedCount > 0 ? ` · ${segment.excludedSuppressedCount} suppressed` : ""}
                    {segment.excludedUnsubscribedCount > 0 ? ` · ${segment.excludedUnsubscribedCount} unsubscribed` : ""}
                    {segment.capped ? " · refine this segment to 2,000 or fewer before composing or sending" : ""}
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
              <input ref={subjectRef} value={subject} onFocus={() => setFocusTarget("subject")} onChange={(event) => { invalidateMessagePreview(); setSubject(event.target.value); }} />
            </Field>
            <Field label="Email body" hint="Plain HTML; tags like <p>, <strong>, <a href> survive sanitization on save.">
              <textarea ref={bodyRef} value={bodyHtml} onFocus={() => setFocusTarget("body")} onChange={(event) => { invalidateMessagePreview(); setBodyHtml(event.target.value); }} />
            </Field>
            <div className="template-vars">
              {variablePaths.map((path) => <button key={path} type="button" onClick={() => insertToken(path)}>{`{{${path}}}`}</button>)}
            </div>
            {unknownTokens.length > 0 && (
              <p className="unknown-token-warning">Unknown variable {unknownTokens.map((token) => `{{${token}}}`).join(", ")} — remove it or pick from the list above.</p>
            )}
            {segment && segment.preview.length > 0 && (
              <Field label="Preview as">
                <Select value={previewContactId} onChange={(event) => { invalidateMessagePreview(); setPreviewContactId(event.target.value as ContactId); }}>
                  {segment.preview.map((recipient) => <option key={recipient.contactId} value={recipient.contactId}>{recipient.name} ({recipient.email})</option>)}
                </Select>
              </Field>
            )}
            <div className="bulk-send-actions">
              {draftDirty && <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>Discard draft</Button>}
              <Button variant="secondary" onClick={() => void onPreview()} disabled={!canCompose || segment?.capped || !previewContactId || compose.isPending}>Preview message</Button>
              <Button onClick={() => setConfirmSend(true)} disabled={!canSend || compose.isPending}>{segment?.capped ? "Refine segment to send" : `Send to ${segment?.contactIds.length ?? 0} recipient${segment?.contactIds.length === 1 ? "" : "s"}`}</Button>
            </div>
          </div>
          <MessagePreview
            label="PREVIEW"
            hint="Rendered for the selected recipient"
            message={currentPreview}
            status={currentPreview ? undefined : "Resolve a segment, write a message, then Preview message."}
          />
        </div>
        {result && (
          <div className="notify-bar">
            <div>
              <span className="metric-icon accent"><Users size={18} /></span>
              <p>
                <b>{acceptedBulkSendCount(result)} accepted · {result.skipped} skipped</b>
                <small>{result.queued} newly queued{result.alreadyQueued > 0 ? ` · ${result.alreadyQueued} already queued by this attempt` : ""}</small>
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
        onConfirm={async () => { if (await onSend()) setConfirmSend(false); }}
        onCancel={() => setConfirmSend(false)}
      />
      <ConfirmDialog
        open={confirmDiscard}
        variant="destructive"
        title="Discard this bulk email draft?"
        body="The selected audience, subject, message, and preview will be cleared. This cannot be undone."
        confirmLabel="Discard draft"
        onConfirm={discardDraft}
        onCancel={() => setConfirmDiscard(false)}
      />
    </div>
  );
}
