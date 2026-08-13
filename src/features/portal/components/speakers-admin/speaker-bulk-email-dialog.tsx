"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { templateVariablePaths } from "@/features/comms/components/sample-vars";
import { unknownTokensClientSide } from "@/features/comms/components/validate-client";
import {
  acceptedBulkSendCount,
  bulkSendPreviewFingerprint,
  bulkSendResultToastOptions,
  canSendBulkMessage,
  claimBulkSendAttempt,
  completeBulkSendAttempt,
  type BulkSendAttempt,
} from "@/features/comms/bulk-send-attempt";
import {
  BULK_SEND_RECOVERY_VERSION,
  classifyBulkSendFailure,
  persistBulkSendRecovery,
  removeBulkSendRecovery,
  type BulkSendRecoverySnapshot,
} from "@/features/comms/bulk-send-recovery";
import { composeBulkSpeakerEmailResultSchema, type ComposeBulkSpeakerEmailResult } from "@/shared/contracts";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Field, Modal, Select } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

type FocusTarget = "subject" | "body";
type ApprovedPreview = {
  result: NonNullable<ComposeBulkSpeakerEmailResult["preview"]>;
  fingerprint: string;
  attempt: BulkSendAttempt;
};

/**
 * M51 — selected/filtered bulk compose (work order step 6). The token picker
 * and unknown-variable check reuse the exact functions the comms admin's
 * template editor uses (`templateVariablePaths`/`unknownTokensClientSide`
 * against `TEMPLATE_VAR_SCHEMAS.speaker_bulk_message`), so the merge surface
 * this dialog advertises can never drift from what the server actually
 * accepts. "Preview" resolves one real recipient's content before anything is
 * queued; "Send" enqueues one email per selected speaker through the ordinary
 * outbox and reports queued/skipped/error counts.
 */
export function SpeakerBulkEmailDialog({ eventId, open, onClose, selected, initialRecovery = null, onRecoveryChange }: {
  eventId: string;
  open: boolean;
  onClose: () => void;
  selected: Array<{ contactId: string; name: string; email: string }>;
  initialRecovery?: BulkSendRecoverySnapshot | null;
  onRecoveryChange?: (snapshot: BulkSendRecoverySnapshot | null) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const recoveryScope = `selected:${eventId}`;
  const restored = initialRecovery?.surface === "speaker" && initialRecovery.scope === recoveryScope
    ? initialRecovery
    : null;
  const audience = restored
    ? restored.recipients.map((recipient) => ({ contactId: recipient.id, name: recipient.name, email: recipient.email }))
    : selected;
  const [subject, setSubject] = useState(restored?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(restored?.bodyHtml ?? "");
  const [focusTarget, setFocusTarget] = useState<FocusTarget>("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [previewContactId, setPreviewContactId] = useState(restored?.previewRecipientId ?? audience[0]?.contactId ?? "");
  const [preview, setPreview] = useState<ApprovedPreview | null>(() => restored ? {
    result: restored.approvedPreview,
    fingerprint: restored.fingerprint,
    attempt: { sendId: restored.sendId, storageKey: restored.attemptStorageKey },
  } : null);
  const [recovery, setRecovery] = useState<BulkSendRecoverySnapshot | null>(restored);
  const [busyPreview, setBusyPreview] = useState(false);
  const [busySend, setBusySend] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<ComposeBulkSpeakerEmailResult | null>(null);
  const recoveryRequired = recovery !== null;
  const draftDirty = !sendResult && (subject.trim().length > 0 || bodyHtml.trim().length > 0 || preview !== null);
  useUnsavedWorkGuard(open && (draftDirty || busySend || recoveryRequired), { blocking: busySend });

  const variablePaths = useMemo(() => templateVariablePaths("speaker_bulk_message"), []);
  const unknownTokens = useMemo(() => unknownTokensClientSide("speaker_bulk_message", subject, bodyHtml), [subject, bodyHtml]);
  const ready = subject.trim().length > 0 && bodyHtml.trim().length > 0 && unknownTokens.length === 0;
  const previewFingerprint = useMemo(() => bulkSendPreviewFingerprint({
    contactIds: audience.map((row) => row.contactId),
    previewContactId,
    subject,
    bodyHtml,
  }), [audience, bodyHtml, previewContactId, subject]);
  const currentPreview = preview?.fingerprint === previewFingerprint ? preview : null;
  const canSend = canSendBulkMessage({
    canCompose: ready,
    capped: false,
    previewFingerprint: preview?.fingerprint ?? null,
    currentFingerprint: previewFingerprint,
  });

  function invalidatePreview() {
    if (recoveryRequired) return;
    setPreview(null);
    setSendResult(null);
    setConfirmSend(false);
  }

  function insertToken(path: string) {
    const token = `{{${path}}}`;
    invalidatePreview();
    if (focusTarget === "subject") {
      const el = subjectRef.current;
      const start = el?.selectionStart ?? subject.length;
      const end = el?.selectionEnd ?? subject.length;
      setSubject(subject.slice(0, start) + token + subject.slice(end));
    } else {
      const el = bodyRef.current;
      const start = el?.selectionStart ?? bodyHtml.length;
      const end = el?.selectionEnd ?? bodyHtml.length;
      setBodyHtml(bodyHtml.slice(0, start) + token + bodyHtml.slice(end));
    }
  }

  function reset() {
    setSubject(""); setBodyHtml(""); setPreview(null); setSendResult(null); setError(null); setConfirmSend(false); setConfirmDiscard(false); setConfirmAbandon(false);
  }

  function finishClose() {
    reset();
    onClose();
  }

  function requestClose() {
    if (busySend) return;
    if (recoveryRequired) {
      onClose();
      return;
    }
    if (draftDirty) {
      setConfirmDiscard(true);
      return;
    }
    finishClose();
  }

  async function runPreview() {
    if (!previewContactId) return;
    setBusyPreview(true);
    setError(null);
    const fingerprint = previewFingerprint;
    setPreview(null);
    try {
      const attempt = await claimBulkSendAttempt(window.sessionStorage, `speaker-selected:${eventId}`, fingerprint);
      const result = await api(`speakers/${eventId}/bulk-email`, composeBulkSpeakerEmailResultSchema, {
        method: "POST",
        body: { contactIds: audience.map((row) => row.contactId), subject, bodyHtml, mode: "preview", previewContactId },
      });
      if (result.preview) setPreview({ result: result.preview, fingerprint, attempt });
    } catch (previewError) {
      setError(isAppError(previewError) ? previewError.message : "Could not build a preview");
    } finally {
      setBusyPreview(false);
    }
  }

  async function runSend(): Promise<boolean> {
    const retryingRecovery = recovery !== null;
    if (!recovery && (!currentPreview || !canSend)) {
      setError("Preview this exact audience and message before sending");
      return false;
    }
    const approved = recovery ?? (currentPreview ? {
      version: BULK_SEND_RECOVERY_VERSION,
      surface: "speaker" as const,
      scope: recoveryScope,
      recipients: audience.map((recipient) => ({ id: recipient.contactId, name: recipient.name, email: recipient.email })),
      previewRecipients: audience.map((recipient) => ({ id: recipient.contactId, name: recipient.name, email: recipient.email })),
      subject,
      bodyHtml,
      previewRecipientId: previewContactId,
      approvedPreview: currentPreview.result,
      sendId: currentPreview.attempt.sendId,
      attemptStorageKey: currentPreview.attempt.storageKey,
      fingerprint: currentPreview.fingerprint,
      completedResults: [],
    } : null);
    if (!approved) return false;
    const stored = persistBulkSendRecovery(window.sessionStorage, approved);
    if (!stored.ok) {
      setError("Can’t send safely because recovery storage is unavailable. Check your browser storage settings and try again.");
      return false;
    }
    setRecovery(stored.snapshot);
    onRecoveryChange?.(stored.snapshot);
    setBusySend(true);
    setError(null);
    try {
      const result = await api(`speakers/${eventId}/bulk-email`, composeBulkSpeakerEmailResultSchema, {
        method: "POST",
        body: { contactIds: approved.recipients.map((row) => row.id), subject: approved.subject, bodyHtml: approved.bodyHtml, mode: "send", sendId: approved.sendId },
      });
      removeBulkSendRecovery(window.sessionStorage, approved);
      completeBulkSendAttempt(window.sessionStorage, { sendId: approved.sendId, storageKey: approved.attemptStorageKey });
      setRecovery(null);
      onRecoveryChange?.(null);
      setSendResult(result);
      toast(
        `${acceptedBulkSendCount(result)} accepted · ${result.queued} newly queued${result.alreadyQueued > 0 ? ` · ${result.alreadyQueued} recovered` : ""}${result.skipped > 0 ? ` · ${result.skipped} skipped` : ""}${result.errors.length > 0 ? ` · ${result.errors.length} could not be sent` : ""}`,
        bulkSendResultToastOptions(result),
      );
      router.refresh();
      return true;
    } catch (sendError) {
      if (classifyBulkSendFailure(sendError, approved.completedResults, retryingRecovery) === "definite") {
        removeBulkSendRecovery(window.sessionStorage, approved);
        completeBulkSendAttempt(window.sessionStorage, { sendId: approved.sendId, storageKey: approved.attemptStorageKey });
        setRecovery(null);
        onRecoveryChange?.(null);
        setError(isAppError(sendError) ? sendError.message : "That did not go through");
      } else {
        setError("We couldn’t confirm whether every email was queued. Retry this unchanged send to recover it safely.");
      }
      return false;
    } finally {
      setBusySend(false);
    }
  }

  function abandonRecovery() {
    if (!recovery) return;
    const removed = removeBulkSendRecovery(window.sessionStorage, recovery);
    if (!removed.ok) {
      setConfirmAbandon(false);
      setError("Recovery could not be cleared safely. Keep this draft and try again.");
      return;
    }
    completeBulkSendAttempt(window.sessionStorage, { sendId: recovery.sendId, storageKey: recovery.attemptStorageKey });
    setRecovery(null);
    onRecoveryChange?.(null);
    finishClose();
  }

  return (
    <>
    <Modal
      open={open}
      onClose={requestClose}
      title={`Email ${audience.length} speaker${audience.length === 1 ? "" : "s"}`}
      description="Every recipient gets their own copy, personalized with the tokens below."
      wide
      footer={sendResult ? (
        <Button onClick={finishClose}>Done</Button>
      ) : recoveryRequired ? (
        <>
          <Button variant="ghost" disabled={busySend} onClick={() => setConfirmAbandon(true)}>Abandon recovery</Button>
          <Button variant="secondary" disabled={busySend} onClick={requestClose}>Close for now</Button>
          <Button disabled={busySend} onClick={() => void runSend()}>{busySend ? "Retrying…" : "Retry this send"}</Button>
        </>
      ) : (
        <>
          <Button variant="secondary" disabled={busySend} onClick={requestClose}>Cancel</Button>
          <Button disabled={!canSend || busySend} onClick={() => setConfirmSend(true)}>{busySend ? "Sending…" : `Send to ${audience.length}`}</Button>
        </>
      )}
    >
      {sendResult ? (
        <div className="form-stack">
          <div className="notify-bar">
            <div>
              <p>
                <b>{acceptedBulkSendCount(sendResult)} accepted</b>
                <small>{sendResult.queued} newly queued{sendResult.alreadyQueued > 0 ? ` · ${sendResult.alreadyQueued} already queued by this attempt` : ""} · {sendResult.skipped} skipped (unsubscribed or suppressed) · {sendResult.errors.length} could not be sent</small>
              </p>
            </div>
          </div>
          {sendResult.errors.length > 0 && <ul className="crm-field-list">
            {sendResult.errors.map((entry) => {
              const recipient = audience.find((row) => row.contactId === entry.contactId);
              return <li key={entry.contactId} style={{ fontSize: 11, color: "var(--muted)" }}>
                <b>{recipient?.name || recipient?.email || "Unknown recipient"}</b>{recipient?.email ? ` (${recipient.email})` : ""}: {entry.reason}
              </li>;
            })}
          </ul>}
        </div>
      ) : (
        <div className="template-editor-grid">
          <div className="form-stack">
            {recoveryRequired && <div className="notify-bar" role="status"><div><p><b>Send outcome needs confirmation</b><small>Retry this unchanged message. The same send ID makes already-queued emails safe to recover.</small></p></div></div>}
            <Field label="Subject">
              <input ref={subjectRef} disabled={recoveryRequired} value={subject} onFocus={() => setFocusTarget("subject")} onChange={(event) => { invalidatePreview(); setSubject(event.target.value); }} placeholder="A note about {{event.name}}" />
            </Field>
            <Field label="Message" hint="Plain HTML; tags like <p>, <strong>, <a href> survive sanitization.">
              <textarea ref={bodyRef} disabled={recoveryRequired} value={bodyHtml} onFocus={() => setFocusTarget("body")} onChange={(event) => { invalidatePreview(); setBodyHtml(event.target.value); }} rows={8} />
            </Field>
            <div className="template-vars">
              {variablePaths.map((path) => <button key={path} type="button" disabled={recoveryRequired} onClick={() => insertToken(path)}>{`{{${path}}}`}</button>)}
            </div>
            {unknownTokens.length > 0 && (
              <p className="unknown-token-warning">Unknown variable {unknownTokens.map((token) => `{{${token}}}`).join(", ")} — remove it or pick from the list above.</p>
            )}
            {error && <p className="field-error" role="alert">{error}</p>}
          </div>
          <aside className="template-editor__preview">
            <Field label="Preview recipient">
              <Select value={previewContactId} disabled={recoveryRequired} onChange={(event) => { invalidatePreview(); setPreviewContactId(event.target.value); }}>
                {audience.map((row) => <option key={row.contactId} value={row.contactId}>{row.name}</option>)}
              </Select>
            </Field>
            <Button size="sm" variant="secondary" disabled={!ready || busyPreview || recoveryRequired} onClick={() => void runPreview()}>{busyPreview ? "Rendering…" : "Refresh preview"}</Button>
            {currentPreview ? (
              <div style={{ marginTop: 12 }}>
                <p><b>{currentPreview.result.subject}</b></p>
                <RichTextView html={currentPreview.result.bodyHtml} />
              </div>
            ) : (
              <p className="long-copy" style={{ marginTop: 12 }}>Refresh to see this recipient&rsquo;s resolved message before sending.</p>
            )}
          </aside>
        </div>
      )}
    </Modal>
    <ConfirmDialog
      open={confirmSend}
      title={`Send this message to ${audience.length} speaker${audience.length === 1 ? "" : "s"}?`}
      body="This queues a personalized email for every selected speaker. Suppressed and unsubscribed addresses are rechecked and skipped at send time."
      confirmLabel={`Send to ${audience.length}`}
      onConfirm={async () => { setConfirmSend(false); await runSend(); }}
      onCancel={() => setConfirmSend(false)}
    />
    <ConfirmDialog
      open={confirmDiscard}
      variant="destructive"
      title="Discard this bulk email draft?"
      body="The selected audience, subject, message, and approved preview will be cleared. This cannot be undone."
      confirmLabel="Discard draft"
      onConfirm={finishClose}
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
    </>
  );
}
