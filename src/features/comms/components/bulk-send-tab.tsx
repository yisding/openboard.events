"use client";

import { Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  acceptedBulkSendCount,
  bulkSendResultToastOptions,
  claimBulkSendAttempt,
  completeBulkSendAttempt,
  type BulkSendAttempt,
} from "../bulk-send-attempt";
import {
  BULK_SEND_RECOVERY_VERSION,
  browserBulkSendRecoveryLockManager,
  classifyBulkSendFailure,
  loadBulkSendRecovery,
  persistBulkSendRecovery,
  removeBulkSendRecovery,
  speakerBulkSendRecoveryIdentity,
  withBulkSendRecoveryLock,
  type BulkSendRecoveryBatchResult,
  type BulkSendRecoverySnapshot,
} from "../bulk-send-recovery";
import {
  CONFIRMATION_STATUSES,
  SPEAKER_WORKFLOW_STATUSES,
  type ComposeBulkSpeakerEmailResult,
  type ConfirmationStatus,
  type ContactId,
  type EventId,
  type ResolvedSpeakerSegment,
  type SpeakerWorkflowStatus,
  composeBulkSpeakerEmailResultSchema,
  contactIdSchema,
  resolvedSpeakerSegmentSchema,
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
import { UnreadableBulkSendRecovery } from "./unreadable-bulk-send-recovery";
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

function confirmedSegmentResult(snapshot: BulkSendRecoverySnapshot): ComposeBulkSpeakerEmailResult | null {
  if (!snapshot.confirmedResult) return null;
  const result = snapshot.confirmedResult;
  const parsed = composeBulkSpeakerEmailResultSchema.safeParse({
    ...result,
    errors: result.errors.map((entry) => ({ contactId: entry.recipientId, reason: entry.reason })),
    preview: null,
  });
  return parsed.success ? parsed.data : null;
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
  const recoveryIdentity = useMemo(() => speakerBulkSendRecoveryIdentity(eventId), [eventId]);

  const [workflowStatus, setWorkflowStatus] = useState<SpeakerWorkflowStatus[]>([]);
  const [confirmationStatus, setConfirmationStatus] = useState<ConfirmationStatus[]>([]);
  const [segment, setSegment] = useState<ResolvedSpeakerSegment | null>(null);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [previewContactId, setPreviewContactId] = useState<ContactId | "">("");
  const [preview, setPreview] = useState<{ subject: string; bodyHtml: string; bodyText: string; fingerprint: string; attempt: BulkSendAttempt } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [result, setResult] = useState<ComposeBulkSpeakerEmailResult | null>(null);
  const [recovery, setRecovery] = useState<BulkSendRecoverySnapshot | null>(null);
  const [recoveryUnreadable, setRecoveryUnreadable] = useState(false);
  const [focusTarget, setFocusTarget] = useState<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const resolveGeneration = useRef(0);

  const currentDraftFingerprint = useMemo(() => bulkMessageDraftFingerprint({
    workflowStatus,
    confirmationStatus,
    subject,
    bodyHtml,
    previewSendId: preview?.attempt.sendId ?? null,
  }), [bodyHtml, confirmationStatus, preview?.attempt.sendId, subject, workflowStatus]);
  const [savedDraftFingerprint, setSavedDraftFingerprint] = useState(() => bulkMessageDraftFingerprint({
    workflowStatus: [],
    confirmationStatus: [],
    subject: "",
    bodyHtml: "",
  }));
  const recoveryRequired = recovery !== null;
  const sendBlocked = recoveryRequired || recoveryUnreadable;
  const draftDirty = currentDraftFingerprint !== savedDraftFingerprint;
  useUnsavedWorkGuard(draftDirty || recoveryRequired || compose.isPending, { blocking: compose.isPending });

  useEffect(() => {
    setRecovery(null);
    setRecoveryUnreadable(false);
    const loaded = loadBulkSendRecovery(window.localStorage, recoveryIdentity);
    if (!loaded.ok) {
      if (loaded.reason === "corrupt" || loaded.reason === "identity_mismatch") setRecoveryUnreadable(true);
      return;
    }
    const snapshot = loaded.snapshot;
    const restoredSegment = resolvedSpeakerSegmentSchema.safeParse({
      matchedCount: snapshot.recipients.length,
      contactIds: snapshot.recipients.map((recipient) => recipient.id),
      capped: false,
      excludedSuppressedCount: 0,
      excludedUnsubscribedCount: 0,
      preview: snapshot.previewRecipients.map((recipient) => ({
        contactId: recipient.id,
        name: recipient.name,
        email: recipient.email,
      })),
    });
    if (!restoredSegment.success) return;
    setSegment(restoredSegment.data);
    setSubject(snapshot.subject);
    setBodyHtml(snapshot.bodyHtml);
    setPreviewContactId(restoredSegment.data.preview.find((recipient) => recipient.contactId === snapshot.previewRecipientId)?.contactId ?? "");
    setPreview({
      subject: snapshot.approvedPreview.subject,
      bodyHtml: snapshot.approvedPreview.bodyHtml,
      bodyText: snapshot.approvedPreview.bodyText,
      fingerprint: snapshot.fingerprint,
      attempt: { sendId: snapshot.sendId, storageKey: snapshot.attemptStorageKey },
    });
    setResult(confirmedSegmentResult(snapshot));
    setRecovery(snapshot);
  }, [eventId, recoveryIdentity]);

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
    if (sendBlocked) return;
    resolveGeneration.current += 1;
    setSegment(null);
    setPreviewContactId("");
    setPreview(null);
    setResult(null);
    setConfirmSend(false);
  }

  function invalidateMessagePreview() {
    if (sendBlocked) return;
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
        bodyText: rendered.preview.bodyText,
        fingerprint,
        attempt,
      });
    } catch {
      toast("Could not render a preview", { kind: "error" });
    }
  }

  async function onSend(): Promise<boolean> {
    const locked = await withBulkSendRecoveryLock(recoveryIdentity, browserBulkSendRecoveryLockManager(), onSendLocked);
    if (!locked.ok) {
      toast(
        locked.reason === "lock_busy"
          ? "Another tab is already preparing or sending email for this event. Finish there before trying again."
          : "This browser can’t safely coordinate bulk email across tabs. Try a current browser or check its privacy settings.",
        { kind: "error", durationMs: 8_000 },
      );
      return false;
    }
    return locked.value;
  }

  async function onSendLocked(): Promise<boolean> {
    if (recoveryUnreadable) {
      toast("Clear the unreadable browser recovery before starting another send", { kind: "error" });
      return false;
    }
    const retryingRecovery = recovery !== null;
    if (!recovery && (!segment || !currentPreview || !canSend)) {
      toast(segment?.capped ? "Refine the audience to 2,000 recipients or fewer" : "Preview this exact audience and message before sending");
      return false;
    }
    const previewRecipient = segment?.preview.find((recipient) => recipient.contactId === previewContactId);
    const candidate = recovery ?? (segment && currentPreview && previewRecipient ? {
      version: BULK_SEND_RECOVERY_VERSION,
      surface: "speaker" as const,
      scope: recoveryIdentity.scope,
      recipients: segment.contactIds.map((id) => {
        const known = segment.preview.find((recipient) => recipient.contactId === id);
        return { id, name: known?.name ?? id, email: known?.email ?? "" };
      }),
      previewRecipients: segment.preview.map((recipient) => ({ id: recipient.contactId, name: recipient.name, email: recipient.email })),
      subject,
      bodyHtml,
      previewRecipientId: previewContactId,
      approvedPreview: {
        recipientEmail: previewRecipient.email,
        recipientName: previewRecipient.name,
        subject: currentPreview.subject,
        bodyHtml: currentPreview.bodyHtml,
        bodyText: currentPreview.bodyText,
      },
      sendId: currentPreview.attempt.sendId,
      attemptStorageKey: currentPreview.attempt.storageKey,
      fingerprint: currentPreview.fingerprint,
      completedResults: [],
      confirmedResult: null,
    } : null);
    if (!candidate) return false;
    const stored = persistBulkSendRecovery(window.localStorage, candidate);
    if (!stored.ok) {
      if (stored.reason === "corrupt" || stored.reason === "identity_mismatch") {
        setRecoveryUnreadable(true);
        toast("An unreadable browser recovery is blocking this send. Clear it explicitly before trying again.", { kind: "error" });
      } else {
        toast("Can’t send safely because recovery storage is unavailable. Check your browser storage settings and try again.", { kind: "error" });
      }
      return false;
    }
    let approved: BulkSendRecoverySnapshot = stored.snapshot;
    setRecovery(approved);
    const completedThisRun: BulkSendRecoveryBatchResult[] = [];
    try {
      // composeBulkSpeakerEmailInputSchema caps contactIds at 200 per call
      // (a browser DataTable-selection limit), well under a resolved
      // segment's own 2,000-recipient ceiling — so a large segment goes out
      // as several compose calls, not one that would fail validation.
      const batches = chunkContactIds(approved.recipients.map((recipient) => contactIdSchema.parse(recipient.id)));
      const results = [];
      for (const contactIds of batches) {
        const batch = await compose.mutateAsync({ contactIds, subject: approved.subject, bodyHtml: approved.bodyHtml, mode: "send", sendId: approved.sendId });
        results.push(batch);
        const generic: BulkSendRecoveryBatchResult = {
          queued: batch.queued,
          alreadyQueued: batch.alreadyQueued,
          skipped: batch.skipped,
          errors: batch.errors.map((entry) => ({ recipientId: entry.contactId, reason: entry.reason })),
        };
        completedThisRun.push(generic);
        const updated: BulkSendRecoverySnapshot = { ...approved, completedResults: [...approved.completedResults, generic] };
        if (persistBulkSendRecovery(window.localStorage, updated).ok) {
          approved = updated;
          setRecovery(updated);
        }
      }
      const sent = mergeBulkSendResults(results);
      const confirmed: BulkSendRecoverySnapshot = {
        ...approved,
        confirmedResult: {
          queued: sent.queued,
          alreadyQueued: sent.alreadyQueued,
          skipped: sent.skipped,
          errors: sent.errors.map((entry) => ({ recipientId: entry.contactId, reason: entry.reason })),
        },
      };
      persistBulkSendRecovery(window.localStorage, confirmed);
      setRecovery(confirmed);
      setResult(sent);
      const removed = removeBulkSendRecovery(window.localStorage, confirmed);
      if (removed.ok) {
        completeBulkSendAttempt(window.sessionStorage, { sendId: approved.sendId, storageKey: approved.attemptStorageKey });
        setRecovery(null);
      } else {
        toast("The send is confirmed, but browser recovery could not be cleared. Try clearing it again before starting another send.", { kind: "error", durationMs: 8_000 });
      }
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
    } catch (caught) {
      if (classifyBulkSendFailure(caught, [...approved.completedResults, ...completedThisRun], retryingRecovery) === "definite") {
        const removed = removeBulkSendRecovery(window.localStorage, approved);
        if (removed.ok) {
          completeBulkSendAttempt(window.sessionStorage, { sendId: approved.sendId, storageKey: approved.attemptStorageKey });
          setRecovery(null);
          toast(caught instanceof Error ? caught.message : "Could not send this message", { kind: "error" });
        } else {
          toast("That request was rejected, but browser recovery could not be cleared. Use Abandon recovery to clear it before starting again.", { kind: "error", durationMs: 8_000 });
        }
      } else {
        toast("We couldn’t confirm whether every email was queued. Retry this unchanged send to recover it safely.", { kind: "error", durationMs: 8_000 });
      }
      return false;
    }
  }

  async function abandonRecovery() {
    if (!recovery) return;
    const locked = await withBulkSendRecoveryLock(recoveryIdentity, browserBulkSendRecoveryLockManager(), () => {
      const removed = removeBulkSendRecovery(window.localStorage, recovery);
      if (!removed.ok) return false;
      completeBulkSendAttempt(window.sessionStorage, { sendId: recovery.sendId, storageKey: recovery.attemptStorageKey });
      setRecovery(null);
      setConfirmAbandon(false);
      discardDraft();
      return true;
    });
    if (!locked.ok || !locked.value) {
      setConfirmAbandon(false);
      toast(locked.ok
        ? "Recovery could not be cleared safely. Keep this draft and try again."
        : "Another tab is using this email recovery. Finish there before abandoning it.", { kind: "error" });
      return;
    }
  }

  async function clearCompletedRecovery() {
    if (!recovery?.confirmedResult) return;
    const locked = await withBulkSendRecoveryLock(recoveryIdentity, browserBulkSendRecoveryLockManager(), () => {
      const removed = removeBulkSendRecovery(window.localStorage, recovery);
      if (!removed.ok) return false;
      completeBulkSendAttempt(window.sessionStorage, { sendId: recovery.sendId, storageKey: recovery.attemptStorageKey });
      setRecovery(null);
      // A restored receipt is complete, not a draft waiting to be sent again.
      // Keep its audience and copy visible, but require a fresh preview/send ID
      // before another intentional send and mark the visible state as saved.
      setPreview(null);
      setSavedDraftFingerprint(bulkMessageDraftFingerprint({
        workflowStatus,
        confirmationStatus,
        subject,
        bodyHtml,
        previewSendId: null,
      }));
      toast("Completed recovery cleared");
      return true;
    });
    if (!locked.ok || !locked.value) {
      toast(locked.ok
        ? "The send is confirmed, but browser recovery still could not be cleared. Check your browser storage settings and try again."
        : "Another tab is using this email recovery. Finish there before clearing it.", { kind: "error" });
      return;
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
      {recoveryUnreadable && <UnreadableBulkSendRecovery
        identity={recoveryIdentity}
        onCleared={() => setRecoveryUnreadable(false)}
      />}
      <section className="panel bulk-send-filters">
        <header className="panel-header"><div><h2>1. Choose a segment</h2><p>Leave a group empty to match every value for it.</p></div></header>
        <div className="form-stack bulk-send-body">
          <Field label="Roster status">
            <div className="bulk-send-checkboxes">
              {SPEAKER_WORKFLOW_STATUSES.map((status) => (
                <label key={status} className="checkbox-row">
                  <input type="checkbox" disabled={sendBlocked} checked={workflowStatus.includes(status)} onChange={() => { invalidateAudience(); setWorkflowStatus((current) => toggle(current, status)); }} />
                  {humanize(status)}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Confirmation status">
            <div className="bulk-send-checkboxes">
              {CONFIRMATION_STATUSES.map((status) => (
                <label key={status} className="checkbox-row">
                  <input type="checkbox" disabled={sendBlocked} checked={confirmationStatus.includes(status)} onChange={() => { invalidateAudience(); setConfirmationStatus((current) => toggle(current, status)); }} />
                  {humanize(status)}
                </label>
              ))}
            </div>
          </Field>
          <Button onClick={() => void onResolve()} disabled={resolveSegment.isPending || sendBlocked}>{resolveSegment.isPending ? "Resolving…" : "Preview audience"}</Button>
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
            {recoveryRequired && <div className="notify-bar" role="status"><div><p>
              <b>{result ? "Send confirmed; cleanup needed" : "Send outcome needs confirmation"}</b>
              <small>{result ? "The email is complete. Clear its browser recovery record before starting another send." : "Retry this unchanged message. The same send ID makes already-queued emails safe to recover."}</small>
            </p></div></div>}
            <Field label="Subject">
              <input ref={subjectRef} disabled={sendBlocked} value={subject} onFocus={() => setFocusTarget("subject")} onChange={(event) => { invalidateMessagePreview(); setSubject(event.target.value); }} />
            </Field>
            <Field label="Email body" hint="Plain HTML; tags like <p>, <strong>, <a href> survive sanitization on save.">
              <textarea ref={bodyRef} disabled={sendBlocked} value={bodyHtml} onFocus={() => setFocusTarget("body")} onChange={(event) => { invalidateMessagePreview(); setBodyHtml(event.target.value); }} />
            </Field>
            <div className="template-vars">
              {variablePaths.map((path) => <button key={path} type="button" disabled={sendBlocked} onClick={() => insertToken(path)}>{`{{${path}}}`}</button>)}
            </div>
            {unknownTokens.length > 0 && (
              <p className="unknown-token-warning">Unknown variable {unknownTokens.map((token) => `{{${token}}}`).join(", ")} — remove it or pick from the list above.</p>
            )}
            {segment && segment.preview.length > 0 && (
              <Field label="Preview as">
                <Select value={previewContactId} disabled={sendBlocked} onChange={(event) => { invalidateMessagePreview(); setPreviewContactId(event.target.value as ContactId); }}>
                  {segment.preview.map((recipient) => <option key={recipient.contactId} value={recipient.contactId}>{recipient.name} ({recipient.email})</option>)}
                </Select>
              </Field>
            )}
            <div className="bulk-send-actions">
              {recoveryRequired
                ? !result && <Button variant="ghost" disabled={compose.isPending} onClick={() => setConfirmAbandon(true)}>Abandon recovery</Button>
                : draftDirty && <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>Discard draft</Button>}
              <Button variant="secondary" onClick={() => void onPreview()} disabled={!canCompose || segment?.capped || !previewContactId || compose.isPending || sendBlocked}>Preview message</Button>
              {recoveryRequired
                ? result
                  ? <Button onClick={clearCompletedRecovery}>Clear completed recovery</Button>
                  : <Button onClick={() => void onSend()} disabled={compose.isPending}>{compose.isPending ? "Retrying…" : "Retry this send"}</Button>
                : <Button onClick={() => setConfirmSend(true)} disabled={!canSend || compose.isPending}>{segment?.capped ? "Refine segment to send" : `Send to ${segment?.contactIds.length ?? 0} recipient${segment?.contactIds.length === 1 ? "" : "s"}`}</Button>}
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
        onConfirm={async () => { setConfirmSend(false); await onSend(); }}
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
      <ConfirmDialog
        open={confirmAbandon}
        variant="destructive"
        title="Abandon this send recovery?"
        body="Only do this after checking the communications log. Starting a new send could otherwise email recipients twice."
        confirmLabel="Abandon recovery"
        onConfirm={abandonRecovery}
        onCancel={() => setConfirmAbandon(false)}
      />
    </div>
  );
}
