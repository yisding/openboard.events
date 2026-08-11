"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { composeCrmBulkEmailResultSchema, type ComposeCrmBulkEmailResult, type OrganizationContactId, type OrganizationId } from "@/shared/contracts";
import {
  acceptedBulkSendCount,
  bulkSendPreviewFingerprint,
  bulkSendResultToastOptions,
  canSendBulkMessage,
  chunkBulkRecipientIds,
  claimBulkSendAttempt,
  completeBulkSendAttempt,
  type BulkSendAttempt,
} from "@/features/comms/bulk-send-attempt";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { Button, Field, Modal } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { CRM_BULK_BATCH_SIZE, mergeCrmBulkEmailResults } from "../bulk-email-helpers";

type ApprovedPreview = {
  result: NonNullable<ComposeCrmBulkEmailResult["preview"]>;
  fingerprint: string;
  attempt: BulkSendAttempt;
};

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
}: {
  organizationId: OrganizationId;
  open: boolean;
  onClose: () => void;
  recipients: { id: OrganizationContactId; name: string; email: string }[];
  /**
   * Recipients with a real, resolved name/email to offer in the "Preview
   * recipient" picker below. Defaults to `recipients` — fine for a directory
   * multi-select, where every selected row is already fully resolved. A
   * segment can carry up to 2,000 ids with only the first 50 previewed
   * server-side (`PREVIEW_SAMPLE`), so `SegmentsView` passes that smaller,
   * fully-named set explicitly rather than letting the id fallback leak in.
   */
  previewRecipients?: { id: OrganizationContactId; name: string; email: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const previewCandidates = previewRecipients ?? recipients;
  const [previewId, setPreviewId] = useState(previewCandidates[0]?.id ?? "");
  const [preview, setPreview] = useState<ApprovedPreview | null>(null);
  const [busyPreview, setBusyPreview] = useState(false);
  const [busySend, setBusySend] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<ComposeCrmBulkEmailResult | null>(null);

  const ready = subject.trim().length > 0 && bodyHtml.trim().length > 0;
  const previewFingerprint = useMemo(() => bulkSendPreviewFingerprint({
    contactIds: recipients.map((row) => row.id),
    previewContactId: previewId,
    subject,
    bodyHtml,
  }), [bodyHtml, previewId, recipients, subject]);
  const currentPreview = preview?.fingerprint === previewFingerprint ? preview : null;
  const canSend = canSendBulkMessage({
    canCompose: ready,
    capped: false,
    previewFingerprint: preview?.fingerprint ?? null,
    currentFingerprint: previewFingerprint,
  });

  function invalidatePreview() {
    setPreview(null);
    setSendResult(null);
    setConfirmSend(false);
  }

  function reset() {
    setSubject(""); setBodyHtml(""); setPreview(null); setSendResult(null); setError(null); setConfirmSend(false);
  }

  async function runPreview() {
    if (!previewId) return;
    setBusyPreview(true);
    setError(null);
    const fingerprint = previewFingerprint;
    setPreview(null);
    try {
      const attempt = await claimBulkSendAttempt(window.sessionStorage, `crm:${organizationId}`, fingerprint);
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
    if (!currentPreview || !canSend) {
      setError("Preview this exact audience and message before sending");
      return false;
    }
    setBusySend(true);
    setError(null);
    try {
      const results = [];
      const recipientIds = recipients.map((row) => row.id);
      for (const organizationContactIds of chunkBulkRecipientIds(recipientIds, CRM_BULK_BATCH_SIZE)) {
        results.push(await api(`organizations/${organizationId}/crm/bulk-email`, composeCrmBulkEmailResultSchema, {
          method: "POST",
          body: { organizationContactIds, subject, bodyHtml, mode: "send", sendId: currentPreview.attempt.sendId },
        }));
      }
      const result = mergeCrmBulkEmailResults(results);
      completeBulkSendAttempt(window.sessionStorage, currentPreview.attempt);
      setSendResult(result);
      toast(
        `${acceptedBulkSendCount(result)} accepted · ${result.queued} newly queued${result.alreadyQueued > 0 ? ` · ${result.alreadyQueued} recovered` : ""}${result.skipped > 0 ? ` · ${result.skipped} skipped` : ""}${result.errors.length > 0 ? ` · ${result.errors.length} could not be sent` : ""}`,
        bulkSendResultToastOptions(result),
      );
      router.refresh();
      return true;
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : "That did not go through");
      return false;
    } finally {
      setBusySend(false);
    }
  }

  return (
    <>
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title={`Email ${recipients.length} contact${recipients.length === 1 ? "" : "s"}`}
      description="Sent through each contact's most recently linked event — a contact never pushed into an event is skipped, not silently dropped."
      wide
      footer={sendResult ? (
        <Button onClick={() => { reset(); onClose(); }}>Done</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button disabled={!canSend || busySend} onClick={() => setConfirmSend(true)}>{busySend ? "Sending…" : `Send to ${recipients.length}`}</Button>
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
              {sendResult.errors.map((entry) => (
                <li key={entry.organizationContactId} style={{ fontSize: 11, color: "var(--muted)" }}>{entry.organizationContactId}: {entry.reason}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="template-editor-grid">
          <div className="form-stack">
            <Field label="Subject">
              <input value={subject} onChange={(event) => { invalidatePreview(); setSubject(event.target.value); }} placeholder="A note for you" />
            </Field>
            <Field label="Message" hint="Plain HTML; tags like <p>, <strong>, <a href> survive sanitization.">
              <textarea value={bodyHtml} onChange={(event) => { invalidatePreview(); setBodyHtml(event.target.value); }} rows={8} />
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
              <select value={previewId} onChange={(event) => { invalidatePreview(); setPreviewId(event.target.value as OrganizationContactId); }}>
                {previewCandidates.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <Button size="sm" variant="secondary" disabled={!ready || busyPreview} onClick={() => void runPreview()}>{busyPreview ? "Rendering…" : "Refresh preview"}</Button>
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
      title={`Send this message to ${recipients.length} contact${recipients.length === 1 ? "" : "s"}?`}
      body="This queues one email per contact through their most recently linked event. Contacts without an event link, plus suppressed or unsubscribed addresses, are skipped."
      confirmLabel={`Send to ${recipients.length}`}
      onConfirm={async () => { if (await runSend()) setConfirmSend(false); }}
      onCancel={() => setConfirmSend(false)}
    />
    </>
  );
}
