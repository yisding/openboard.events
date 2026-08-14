"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { composeCrmBulkEmailResultSchema, type ComposeCrmBulkEmailResult, type OrganizationId } from "@/shared/contracts";
import {
  acceptedBulkSendCount,
  abandonBulkSendAttempt,
  bulkSendPreviewFingerprint,
  bulkSendResultToastOptions,
  canSendBulkMessage,
  chunkBulkRecipientIds,
  claimBulkSendAttempt,
  completeBulkSendAttempt,
  verifyBulkSendAttempt,
  type BulkSendAttempt,
} from "@/features/comms/bulk-send-attempt";
import {
  BULK_SEND_RECOVERY_VERSION,
  browserBulkSendRecoveryLockManager,
  bulkSendAttemptScope,
  loadBulkSendRecovery,
  persistBulkSendRecovery,
  removeBulkSendRecovery,
  withBulkSendRecoveryLock,
  type BulkSendRecoveryBatchResult,
  type BulkSendRecoverySnapshot,
} from "@/features/comms/bulk-send-recovery";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { Button, Field, Modal, Select } from "@/shared/ui/ui-kit";
import { useUnsavedWorkGuard } from "@/shared/ui/app/unsaved-work-guard";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { CRM_BULK_BATCH_SIZE, mergeCrmBulkEmailResults } from "../bulk-email-helpers";

type ApprovedPreview = {
  result: NonNullable<ComposeCrmBulkEmailResult["preview"]>;
  fingerprint: string;
  attempt: BulkSendAttempt;
};

function confirmedCrmResult(snapshot: BulkSendRecoverySnapshot | null): ComposeCrmBulkEmailResult | null {
  if (!snapshot?.confirmedResult) return null;
  const result = snapshot.confirmedResult;
  const parsed = composeCrmBulkEmailResultSchema.safeParse({
    ...result,
    errors: result.errors.map((entry) => ({ organizationContactId: entry.recipientId, reason: entry.reason })),
    preview: null,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * M55 — CRM bulk communication (selected rows or a resolved segment).
 * Delegates server-side to M51's `composeBulkSpeakerEmailIn` per the event an
 * organization contact was most recently pushed into
 * (`composeCrmBulkEmailIn`'s doc comment) — never a second sender. A contact
 * with no event link yet cannot receive mail this way and comes back as a
 * named skip, which the result panel surfaces rather than hiding.
 */
export function CrmBulkEmailDialog({
  organizationId,
  open,
  onClose,
  recipients,
  previewRecipients,
  initialRecovery = null,
  onRecoveryChange,
}: {
  organizationId: OrganizationId;
  open: boolean;
  onClose: () => void;
  recipients: { id: string; name: string; email: string }[];
  /**
   * Recipients with a real, resolved name/email to offer in the "Preview
   * recipient" picker below. Defaults to `recipients` — fine for a directory
   * multi-select, where every selected row is already fully resolved. A
   * segment can carry up to 2,000 ids with only the first 50 previewed
   * server-side (`PREVIEW_SAMPLE`), so `SegmentsView` passes that smaller,
   * fully-named set explicitly rather than letting the id fallback leak in.
   */
  previewRecipients?: { id: string; name: string; email: string }[];
  initialRecovery?: BulkSendRecoverySnapshot | null;
  onRecoveryChange?: (snapshot: BulkSendRecoverySnapshot | null) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const recoveryScope = organizationId as string;
  const recoveryIdentity = { surface: "crm" as const, scope: recoveryScope };
  const restored = initialRecovery?.surface === "crm" && initialRecovery.scope === recoveryScope
    ? initialRecovery
    : null;
  const [audience] = useState(() => restored?.recipients ?? recipients);
  const [previewCandidates] = useState(() => restored?.previewRecipients ?? previewRecipients ?? recipients);
  const [subject, setSubject] = useState(restored?.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(restored?.bodyHtml ?? "");
  const [previewId, setPreviewId] = useState(restored?.previewRecipientId ?? previewCandidates[0]?.id ?? "");
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
  const [sendResult, setSendResult] = useState<ComposeCrmBulkEmailResult | null>(() => confirmedCrmResult(restored));
  const recoveryRequired = recovery !== null;
  const draftDirty = !sendResult && (subject.trim().length > 0 || bodyHtml.trim().length > 0 || preview !== null);
  useUnsavedWorkGuard(open && (draftDirty || busySend || recoveryRequired), { blocking: busySend });

  const ready = subject.trim().length > 0 && bodyHtml.trim().length > 0;
  const previewFingerprint = useMemo(() => bulkSendPreviewFingerprint({
    contactIds: audience.map((row) => row.id),
    previewContactId: previewId,
    subject,
    bodyHtml,
  }), [audience, bodyHtml, previewId, subject]);
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
    if (!previewId) return;
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
          ? "Another tab is preparing or sending CRM email. Finish there before previewing again."
          : "This browser can’t safely coordinate bulk email across tabs. Try a current browser or check its privacy settings.");
        return;
      }
      if (!claimed.value) {
        setError("Another tab has a CRM email recovery. Resume or clear it before previewing a new send.");
        return;
      }
      const attempt = claimed.value;
      const result = await api(`organizations/${organizationId}/crm/bulk-email`, composeCrmBulkEmailResultSchema, {
        method: "POST",
        body: { organizationContactIds: [previewId], subject, bodyHtml, mode: "preview", previewOrganizationContactId: previewId },
      });
      if (result.preview) setPreview({ result: result.preview, fingerprint, attempt });
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : "Could not build a preview");
    } finally {
      setBusyPreview(false);
    }
  }

  async function runSend(): Promise<boolean> {
    const locked = await withBulkSendRecoveryLock(
      recoveryIdentity,
      browserBulkSendRecoveryLockManager(),
      runSendLocked,
    );
    if (!locked.ok) {
      setError(locked.reason === "lock_busy"
        ? "Another tab is already preparing or sending CRM email. Finish there before trying again."
        : "This browser can’t safely coordinate bulk email across tabs. Try a current browser or check its privacy settings.");
      return false;
    }
    return locked.value;
  }

  async function runSendLocked(): Promise<boolean> {
    if (!recovery && (!currentPreview || !canSend)) {
      setError("Preview this exact audience and message before sending");
      return false;
    }
    const candidate = recovery ?? (currentPreview ? {
      version: BULK_SEND_RECOVERY_VERSION,
      surface: "crm" as const,
      scope: recoveryScope,
      recipients: audience.map((recipient) => ({ id: recipient.id, name: recipient.name, email: recipient.email })),
      previewRecipients: previewCandidates.map((recipient) => ({ id: recipient.id, name: recipient.name, email: recipient.email })),
      subject,
      bodyHtml,
      previewRecipientId: previewId,
      approvedPreview: currentPreview.result,
      sendId: currentPreview.attempt.sendId,
      attemptStorageKey: currentPreview.attempt.storageKey,
      fingerprint: currentPreview.fingerprint,
      completedResults: [],
      confirmedResult: null,
    } : null);
    if (!candidate) return false;
    const attempt = { sendId: candidate.sendId, storageKey: candidate.attemptStorageKey };
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
    const stored = persistBulkSendRecovery(window.localStorage, candidate);
    if (!stored.ok) {
      setError("Can’t send safely because recovery storage is unavailable. Check your browser storage settings and try again.");
      return false;
    }
    let approved: BulkSendRecoverySnapshot = stored.snapshot;
    setRecovery(approved);
    onRecoveryChange?.(approved);
    setBusySend(true);
    setError(null);
    try {
      const results = [];
      const attemptResults: BulkSendRecoveryBatchResult[] = [];
      const recipientIds = approved.recipients.map((row) => row.id);
      for (const organizationContactIds of chunkBulkRecipientIds(recipientIds, CRM_BULK_BATCH_SIZE)) {
        const batch = await api(`organizations/${organizationId}/crm/bulk-email`, composeCrmBulkEmailResultSchema, {
          method: "POST",
          body: { organizationContactIds, subject: approved.subject, bodyHtml: approved.bodyHtml, mode: "send", sendId: approved.sendId },
        });
        results.push(batch);
        const generic: BulkSendRecoveryBatchResult = {
          queued: batch.queued,
          alreadyQueued: batch.alreadyQueued,
          skipped: batch.skipped,
          errors: batch.errors.map((entry) => ({ recipientId: entry.organizationContactId, reason: entry.reason })),
        };
        attemptResults.push(generic);
        const updated: BulkSendRecoverySnapshot = { ...approved, completedResults: attemptResults };
        if (persistBulkSendRecovery(window.localStorage, updated).ok) {
          approved = updated;
          setRecovery(updated);
          onRecoveryChange?.(updated);
        }
      }
      const result = mergeCrmBulkEmailResults(results);
      const confirmed: BulkSendRecoverySnapshot = {
        ...approved,
        confirmedResult: {
          queued: result.queued,
          alreadyQueued: result.alreadyQueued,
          skipped: result.skipped,
          errors: result.errors.map((entry) => ({ recipientId: entry.organizationContactId, reason: entry.reason })),
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
    } catch {
      // One CRM HTTP request fans out across event groups server-side. A
      // structured failure from a later group cannot prove an earlier group
      // did not commit, so every send failure remains recoverable with the
      // frozen send ID until the organizer explicitly abandons it.
      setError("We couldn’t confirm whether every email was queued. Retry this unchanged send to recover it safely.");
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
      title={`Email ${audience.length} contact${audience.length === 1 ? "" : "s"}`}
      description="Sent through each contact's most recently linked event — a contact never pushed into an event is skipped, not silently dropped."
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
                <small>{sendResult.queued} newly queued{sendResult.alreadyQueued > 0 ? ` · ${sendResult.alreadyQueued} already queued by this attempt` : ""} · {sendResult.skipped} skipped · {sendResult.errors.length} could not be sent</small>
              </p>
            </div>
          </div>
          {sendResult.errors.length > 0 && (
            <ul className="crm-field-list">
              {sendResult.errors.map((entry) => {
                const recipient = audience.find((row) => row.id === entry.organizationContactId);
                return <li key={entry.organizationContactId} style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                  <b>{recipient?.name || recipient?.email || "Unknown recipient"}</b>{recipient?.email ? ` (${recipient.email})` : ""}: {entry.reason}
                </li>;
              })}
            </ul>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      ) : (
        <div className="template-editor-grid">
          <div className="form-stack">
            {recoveryRequired && <div className="notify-bar" role="status"><div><p><b>Send outcome needs confirmation</b><small>Retry this unchanged message. The same send ID makes already-queued emails safe to recover.</small></p></div></div>}
            <Field label="Subject">
              <input disabled={recoveryRequired} value={subject} onChange={(event) => { invalidatePreview(); setSubject(event.target.value); }} placeholder="A note for you" />
            </Field>
            <Field label="Message" hint="Plain HTML; tags like <p>, <strong>, <a href> survive sanitization.">
              <textarea disabled={recoveryRequired} value={bodyHtml} onChange={(event) => { invalidatePreview(); setBodyHtml(event.target.value); }} rows={8} />
            </Field>
            {error && <p className="field-error" role="alert">{error}</p>}
          </div>
          <aside className="template-editor__preview">
            <Field
              label="Preview recipient"
              {...(previewCandidates.length < recipients.length
                ? { hint: `Showing the first ${previewCandidates.length} of ${recipients.length} — every recipient still gets the send.` }
                : {})}
            >
              <Select value={previewId} disabled={recoveryRequired} onChange={(event) => { invalidatePreview(); setPreviewId(event.target.value); }}>
                {previewCandidates.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </Select>
            </Field>
            <Button size="sm" variant="secondary" disabled={!ready || busyPreview || recoveryRequired} onClick={() => void runPreview()}>{busyPreview ? "Rendering…" : "Refresh preview"}</Button>
            {currentPreview ? (
              <div style={{ marginTop: 12 }}>
                <p><b>{currentPreview.result.subject}</b></p>
                <RichTextView html={currentPreview.result.bodyHtml} />
              </div>
            ) : (
              <p className="long-copy" style={{ marginTop: 12 }}>Refresh to see this recipient&rsquo;s resolved message, or the reason it will be skipped.</p>
            )}
          </aside>
        </div>
      )}
    </Modal>
    <ConfirmDialog
      open={confirmSend}
      title={`Send this message to ${audience.length} contact${audience.length === 1 ? "" : "s"}?`}
      body="This queues one email per contact through their most recently linked event. Contacts without an event link, plus suppressed or unsubscribed addresses, are skipped."
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
