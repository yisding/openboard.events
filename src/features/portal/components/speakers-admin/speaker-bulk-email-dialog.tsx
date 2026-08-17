"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { templateVariablePaths, unknownTokensClientSide } from "@/features/comms/index.templates";
import {
  acceptedBulkSendCount,
  abandonBulkSendAttempt,
  bulkSendPreviewFingerprint,
  bulkSendResultToastOptions,
  canSendBulkMessage,
  chunkBulkRecipientIds,
  claimBulkSendAttempt,
  completeBulkSendAttempt,
  mergeBulkSendResults,
  verifyBulkSendAttempt,
  type BulkSendAttempt,
} from "@/features/comms/index.bulk-send-attempt";
import {
  BULK_SEND_RECOVERY_VERSION,
  browserBulkSendRecoveryLockManager,
  bulkSendAttemptScope,
  classifyBulkSendFailure,
  loadBulkSendRecovery,
  persistBulkSendRecovery,
  removeBulkSendRecovery,
  speakerBulkSendRecoveryIdentity,
  withBulkSendRecoveryLock,
  type BulkSendRecoveryBatchResult,
  type BulkSendRecoverySnapshot,
} from "@/features/comms/index.bulk-send-recovery";
import { composeBulkSpeakerEmailResultSchema, type ComposeBulkSpeakerEmailResult } from "@/shared/contracts";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { FilterSelect } from "@/shared/ui/app/filter-select";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { Button, Field, Modal } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

type FocusTarget = "subject" | "body";
type ApprovedPreview = {
  result: NonNullable<ComposeBulkSpeakerEmailResult["preview"]>;
  fingerprint: string;
  attempt: BulkSendAttempt;
};

function confirmedSpeakerResult(snapshot: BulkSendRecoverySnapshot | null): ComposeBulkSpeakerEmailResult | null {
  if (!snapshot?.confirmedResult) return null;
  const result = snapshot.confirmedResult;
  const parsed = composeBulkSpeakerEmailResultSchema.safeParse({
    ...result,
    errors: result.errors.map((entry) => ({ contactId: entry.recipientId, reason: entry.reason })),
    preview: null,
  });
  return parsed.success ? parsed.data : null;
}

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
  const recoveryIdentity = speakerBulkSendRecoveryIdentity(eventId);
  const restored = initialRecovery?.surface === "speaker" && initialRecovery.scope === recoveryIdentity.scope
    ? initialRecovery
    : null;
  const [audience] = useState(() => restored
    ? restored.recipients.map((recipient) => ({ contactId: recipient.id, name: recipient.name, email: recipient.email }))
    : selected);
  const [subject, setSubject] = useState(restored?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(restored?.bodyHtml ?? "");
  const [focusTarget, setFocusTarget] = useState<FocusTarget>("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [previewContactId, setPreviewContactId] = useState(restored?.previewRecipientId ?? audience[0]?.contactId ?? "");
  // A bulk email to a whole roster is exactly the list a native dropdown gives
  // up on: the audience is every speaker the organizer selected, so the picker
  // is filterable and searches the address too — two speakers can share a name,
  // and the address is how the sender tells them apart.
  const previewOptions = useMemo(
    () => audience.map((row) => ({ value: row.contactId, label: row.name, hint: row.email })),
    [audience],
  );
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
  const [sendResult, setSendResult] = useState<ComposeBulkSpeakerEmailResult | null>(() => confirmedSpeakerResult(restored));
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
      const claimed = await withBulkSendRecoveryLock(
        recoveryIdentity,
        browserBulkSendRecoveryLockManager(),
        () => {
          const pending = loadBulkSendRecovery(window.localStorage, recoveryIdentity);
          return !pending.ok && pending.reason === "missing"
            ? claimBulkSendAttempt(window.localStorage, bulkSendAttemptScope(recoveryIdentity), fingerprint)
            : null;
        },
      );
      if (!claimed.ok) {
        setError(claimed.reason === "lock_busy"
          ? "Another tab is preparing or sending email for this event. Finish there before previewing again."
          : "This browser can’t safely coordinate bulk email across tabs. Try a current browser or check its privacy settings.");
        return;
      }
      if (!claimed.value) {
        setError("Another tab has an email recovery for this event. Resume or clear it before previewing a new send.");
        return;
      }
      const attempt = claimed.value;
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
    const locked = await withBulkSendRecoveryLock(recoveryIdentity, browserBulkSendRecoveryLockManager(), runSendLocked);
    if (!locked.ok) {
      setError(locked.reason === "lock_busy"
        ? "Another tab is already preparing or sending email for this event. Finish there before trying again."
        : "This browser can’t safely coordinate bulk email across tabs. Try a current browser or check its privacy settings.");
      return false;
    }
    return locked.value;
  }

  async function runSendLocked(): Promise<boolean> {
    const retryingRecovery = recovery !== null;
    if (!recovery && (!currentPreview || !canSend)) {
      setError("Preview this exact audience and message before sending");
      return false;
    }
    let approved = recovery ?? (currentPreview ? {
      version: BULK_SEND_RECOVERY_VERSION,
      surface: "speaker" as const,
      scope: recoveryIdentity.scope,
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
      confirmedResult: null,
    } : null);
    if (!approved) return false;
    const attempt = { sendId: approved.sendId, storageKey: approved.attemptStorageKey };
    if (recovery) {
      const current = loadBulkSendRecovery(window.localStorage, recoveryIdentity);
      if (!current.ok || current.snapshot.sendId !== recovery.sendId) {
        setError("This recovery changed in another tab. Close and reopen it before taking another action.");
        return false;
      }
    } else {
      const current = verifyBulkSendAttempt(window.localStorage, attempt);
      if (!current.ok || current.status !== "active") {
        setPreview(null);
        setError("This approved preview was completed or replaced in another tab. Refresh the preview before sending again.");
        return false;
      }
    }
    const stored = persistBulkSendRecovery(window.localStorage, approved);
    if (!stored.ok) {
      setError("Can’t send safely because recovery storage is unavailable. Check your browser storage settings and try again.");
      return false;
    }
    setRecovery(stored.snapshot);
    onRecoveryChange?.(stored.snapshot);
    setBusySend(true);
    setError(null);
    const completedThisRun: BulkSendRecoveryBatchResult[] = [];
    try {
      const results = [];
      for (const contactIds of chunkBulkRecipientIds(approved.recipients.map((row) => row.id))) {
        const batch = await api(`speakers/${eventId}/bulk-email`, composeBulkSpeakerEmailResultSchema, {
          method: "POST",
          body: { contactIds, subject: approved.subject, bodyHtml: approved.bodyHtml, mode: "send", sendId: approved.sendId },
        });
        results.push(batch);
        completedThisRun.push({
          queued: batch.queued,
          alreadyQueued: batch.alreadyQueued,
          skipped: batch.skipped,
          errors: batch.errors.map((entry) => ({ recipientId: entry.contactId, reason: entry.reason })),
        });
        const updated: BulkSendRecoverySnapshot = { ...approved, completedResults: completedThisRun };
        if (persistBulkSendRecovery(window.localStorage, updated).ok) {
          approved = updated;
          setRecovery(updated);
          onRecoveryChange?.(updated);
        }
      }
      const result = mergeBulkSendResults(results);
      const confirmed: BulkSendRecoverySnapshot = {
        ...approved,
        confirmedResult: {
          queued: result.queued,
          alreadyQueued: result.alreadyQueued,
          skipped: result.skipped,
          errors: result.errors.map((entry) => ({ recipientId: entry.contactId, reason: entry.reason })),
        },
      };
      const confirmedStored = persistBulkSendRecovery(window.localStorage, confirmed);
      setRecovery(confirmed);
      onRecoveryChange?.(confirmed);
      setSendResult(result);
      const completed = confirmedStored.ok
        ? completeBulkSendAttempt(window.localStorage, attempt)
        : confirmedStored;
      const removed = completed.ok ? removeBulkSendRecovery(window.localStorage, confirmed) : completed;
      if (confirmedStored.ok && completed.ok && removed.ok) {
        setRecovery(null);
        onRecoveryChange?.(null);
      } else {
        setError(confirmedStored.ok
          ? "The send is confirmed, but browser recovery could not be cleared. Try clearing it again before starting another send."
          : "The send is confirmed, but its receipt could not be saved. Keep this dialog open and clear recovery after browser storage is available.");
      }
      toast(
        `${acceptedBulkSendCount(result)} accepted · ${result.queued} newly queued${result.alreadyQueued > 0 ? ` · ${result.alreadyQueued} recovered` : ""}${result.skipped > 0 ? ` · ${result.skipped} skipped` : ""}${result.errors.length > 0 ? ` · ${result.errors.length} could not be sent` : ""}`,
        bulkSendResultToastOptions(result),
      );
      router.refresh();
      return true;
    } catch (sendError) {
      if (classifyBulkSendFailure(sendError, completedThisRun, retryingRecovery) === "definite") {
        const abandoned = abandonBulkSendAttempt(window.localStorage, attempt);
        const removed = abandoned.ok ? removeBulkSendRecovery(window.localStorage, approved) : abandoned;
        if (abandoned.ok && removed.ok) {
          setRecovery(null);
          onRecoveryChange?.(null);
          setError(isAppError(sendError) ? sendError.message : "That did not go through");
        } else {
          setError("That request was rejected, but browser recovery could not be cleared. Use Abandon recovery to clear it before starting again.");
        }
      } else {
        setError("We couldn’t confirm whether every email was queued. Retry this unchanged send to recover it safely.");
      }
      return false;
    } finally {
      setBusySend(false);
    }
  }

  async function abandonRecovery() {
    if (!recovery) return;
    const locked = await withBulkSendRecoveryLock(recoveryIdentity, browserBulkSendRecoveryLockManager(), () => {
      const abandoned = abandonBulkSendAttempt(window.localStorage, { sendId: recovery.sendId, storageKey: recovery.attemptStorageKey });
      if (!abandoned.ok) return false;
      const removed = removeBulkSendRecovery(window.localStorage, recovery);
      if (!removed.ok) return false;
      setRecovery(null);
      onRecoveryChange?.(null);
      finishClose();
      return true;
    });
    if (!locked.ok || !locked.value) {
      setConfirmAbandon(false);
      setError(locked.ok
        ? "Recovery could not be cleared safely. Keep this draft and try again."
        : "Another tab is using this email recovery. Finish there before abandoning it.");
      return;
    }
  }

  async function clearCompletedRecovery() {
    if (!recovery?.confirmedResult) return;
    const locked = await withBulkSendRecoveryLock(recoveryIdentity, browserBulkSendRecoveryLockManager(), () => {
      const stored = persistBulkSendRecovery(window.localStorage, recovery);
      if (!stored.ok) return false;
      const completed = completeBulkSendAttempt(window.localStorage, { sendId: recovery.sendId, storageKey: recovery.attemptStorageKey });
      if (!completed.ok) return false;
      const removed = removeBulkSendRecovery(window.localStorage, recovery);
      if (!removed.ok) return false;
      setRecovery(null);
      onRecoveryChange?.(null);
      setError(null);
      return true;
    });
    if (!locked.ok || !locked.value) {
      setError(locked.ok
        ? "The send is confirmed, but browser recovery still could not be cleared. Check your browser storage settings and try again."
        : "Another tab is using this email recovery. Finish there before clearing it.");
      return;
    }
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
        recoveryRequired ? <>
          <Button variant="secondary" onClick={requestClose}>Close for now</Button>
          <Button onClick={clearCompletedRecovery}>Clear completed recovery</Button>
        </> : <Button onClick={finishClose}>Done</Button>
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
              return <li key={entry.contactId} style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                <b>{recipient?.name || recipient?.email || "Unknown recipient"}</b>{recipient?.email ? ` (${recipient.email})` : ""}: {entry.reason}
              </li>;
            })}
          </ul>}
          {error && <p className="field-error" role="alert">{error}</p>}
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
              <FilterSelect
                value={previewContactId}
                onChange={(next) => { invalidatePreview(); setPreviewContactId(next); }}
                options={previewOptions}
                disabled={recoveryRequired}
                ariaLabel="Preview recipient"
                filterPlaceholder="Filter by name or email…"
                emptyLabel="No speaker in this audience matches"
              />
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
