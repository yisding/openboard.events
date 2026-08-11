"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { composeCrmBulkEmailResultSchema, type ComposeCrmBulkEmailResult, type OrganizationContactId, type OrganizationId } from "@/shared/contracts";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { Button, Field, Modal } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

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
  const [previewResult, setPreviewResult] = useState<ComposeCrmBulkEmailResult["preview"]>(null);
  const [busyPreview, setBusyPreview] = useState(false);
  const [busySend, setBusySend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<ComposeCrmBulkEmailResult | null>(null);

  const ready = subject.trim().length > 0 && bodyHtml.trim().length > 0;

  function reset() {
    setSubject(""); setBodyHtml(""); setPreviewResult(null); setSendResult(null); setError(null);
  }

  async function runPreview() {
    if (!previewId) return;
    setBusyPreview(true);
    setError(null);
    try {
      const result = await api(`organizations/${organizationId}/crm/bulk-email`, composeCrmBulkEmailResultSchema, {
        method: "POST",
        body: { organizationContactIds: recipients.map((row) => row.id), subject, bodyHtml, mode: "preview", previewOrganizationContactId: previewId },
      });
      setPreviewResult(result.preview);
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : "Could not build a preview");
    } finally {
      setBusyPreview(false);
    }
  }

  async function runSend() {
    setBusySend(true);
    setError(null);
    try {
      const result = await api(`organizations/${organizationId}/crm/bulk-email`, composeCrmBulkEmailResultSchema, {
        method: "POST",
        body: { organizationContactIds: recipients.map((row) => row.id), subject, bodyHtml, mode: "send" },
      });
      setSendResult(result);
      toast(`${result.queued} queued${result.skipped > 0 ? ` · ${result.skipped} skipped` : ""}${result.errors.length > 0 ? ` · ${result.errors.length} could not be sent` : ""}`);
      router.refresh();
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : "That did not go through");
    } finally {
      setBusySend(false);
    }
  }

  return (
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
          <Button disabled={!ready || busySend} onClick={() => void runSend()}>{busySend ? "Sending…" : `Send to ${recipients.length}`}</Button>
        </>
      )}
    >
      {sendResult ? (
        <div className="form-stack">
          <div className="notify-bar">
            <div>
              <p>
                <b>{sendResult.queued} queued</b>
                <small>{sendResult.skipped} skipped · {sendResult.errors.length} could not be sent</small>
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
              <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="A note for you" />
            </Field>
            <Field label="Message" hint="Plain HTML; tags like <p>, <strong>, <a href> survive sanitization.">
              <textarea value={bodyHtml} onChange={(event) => setBodyHtml(event.target.value)} rows={8} />
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
              <select value={previewId} onChange={(event) => { setPreviewId(event.target.value as OrganizationContactId); setPreviewResult(null); }}>
                {previewCandidates.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <Button size="sm" variant="secondary" disabled={!ready || busyPreview} onClick={() => void runPreview()}>{busyPreview ? "Rendering…" : "Refresh preview"}</Button>
            {previewResult ? (
              <div style={{ marginTop: 12 }}>
                <p><b>{previewResult.subject}</b></p>
                <RichTextView html={previewResult.bodyHtml} />
              </div>
            ) : (
              <p className="long-copy" style={{ marginTop: 12 }}>Refresh to see this recipient&rsquo;s resolved message, or the reason it will be skipped.</p>
            )}
          </aside>
        </div>
      )}
    </Modal>
  );
}
