"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { templateVariablePaths } from "@/features/comms/components/sample-vars";
import { unknownTokensClientSide } from "@/features/comms/components/validate-client";
import type { ContactListRow } from "@/features/portal";
import type { ComposeBulkSpeakerEmailResult } from "@/shared/contracts";
import { ConfirmDialog } from "@/shared/ui/app/confirm-dialog";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { Button, Field, Modal } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

type FocusTarget = "subject" | "body";

async function compose(eventId: string, body: Record<string, unknown>): Promise<ComposeBulkSpeakerEmailResult> {
  const response = await fetch(`/api/internal/speakers/${eventId}/bulk-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json() as { data?: ComposeBulkSpeakerEmailResult; error?: { message?: string } };
  if (!response.ok || !json.data) throw new Error(json.error?.message ?? "That did not go through");
  return json.data;
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
export function SpeakerBulkEmailDialog({ eventId, open, onClose, selected }: {
  eventId: string; open: boolean; onClose: () => void; selected: ContactListRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [focusTarget, setFocusTarget] = useState<FocusTarget>("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [previewContactId, setPreviewContactId] = useState(selected[0]?.contactId ?? "");
  const [previewResult, setPreviewResult] = useState<ComposeBulkSpeakerEmailResult["preview"]>(null);
  const [busyPreview, setBusyPreview] = useState(false);
  const [busySend, setBusySend] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<ComposeBulkSpeakerEmailResult | null>(null);

  const variablePaths = useMemo(() => templateVariablePaths("speaker_bulk_message"), []);
  const unknownTokens = useMemo(() => unknownTokensClientSide("speaker_bulk_message", subject, bodyHtml), [subject, bodyHtml]);
  const ready = subject.trim().length > 0 && bodyHtml.trim().length > 0 && unknownTokens.length === 0;

  function insertToken(path: string) {
    const token = `{{${path}}}`;
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
    setSubject(""); setBodyHtml(""); setPreviewResult(null); setSendResult(null); setError(null); setConfirmSend(false);
  }

  async function runPreview() {
    if (!previewContactId) return;
    setBusyPreview(true);
    setError(null);
    try {
      const result = await compose(eventId, {
        contactIds: selected.map((row) => row.contactId),
        subject, bodyHtml, mode: "preview", previewContactId,
      });
      setPreviewResult(result.preview);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Could not build a preview");
    } finally {
      setBusyPreview(false);
    }
  }

  async function runSend(): Promise<boolean> {
    setBusySend(true);
    setError(null);
    try {
      const result = await compose(eventId, {
        contactIds: selected.map((row) => row.contactId),
        subject, bodyHtml, mode: "send",
      });
      setSendResult(result);
      toast(`${result.queued} queued${result.skipped > 0 ? ` · ${result.skipped} skipped` : ""}${result.errors.length > 0 ? ` · ${result.errors.length} could not be sent` : ""}`);
      router.refresh();
      return true;
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "That did not go through");
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
      title={`Email ${selected.length} speaker${selected.length === 1 ? "" : "s"}`}
      description="Every recipient gets their own copy, personalized with the tokens below."
      wide
      footer={sendResult ? (
        <Button onClick={() => { reset(); onClose(); }}>Done</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button disabled={!ready || busySend} onClick={() => setConfirmSend(true)}>{busySend ? "Sending…" : `Send to ${selected.length}`}</Button>
        </>
      )}
    >
      {sendResult ? (
        <div className="form-stack">
          <div className="notify-bar">
            <div>
              <p>
                <b>{sendResult.queued} queued</b>
                <small>{sendResult.skipped} skipped (unsubscribed or suppressed) · {sendResult.errors.length} could not be sent</small>
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="template-editor-grid">
          <div className="form-stack">
            <Field label="Subject">
              <input ref={subjectRef} value={subject} onFocus={() => setFocusTarget("subject")} onChange={(event) => setSubject(event.target.value)} placeholder="A note about {{event.name}}" />
            </Field>
            <Field label="Message" hint="Plain HTML; tags like <p>, <strong>, <a href> survive sanitization.">
              <textarea ref={bodyRef} value={bodyHtml} onFocus={() => setFocusTarget("body")} onChange={(event) => setBodyHtml(event.target.value)} rows={8} />
            </Field>
            <div className="template-vars">
              {variablePaths.map((path) => <button key={path} type="button" onClick={() => insertToken(path)}>{`{{${path}}}`}</button>)}
            </div>
            {unknownTokens.length > 0 && (
              <p className="unknown-token-warning">Unknown variable {unknownTokens.map((token) => `{{${token}}}`).join(", ")} — remove it or pick from the list above.</p>
            )}
            {error && <p className="field-error" role="alert">{error}</p>}
          </div>
          <aside className="template-editor__preview">
            <Field label="Preview recipient">
              <select value={previewContactId} onChange={(event) => { setPreviewContactId(event.target.value); setPreviewResult(null); }}>
                {selected.map((row) => <option key={row.contactId} value={row.contactId}>{row.name}</option>)}
              </select>
            </Field>
            <Button size="sm" variant="secondary" disabled={!ready || busyPreview} onClick={() => void runPreview()}>{busyPreview ? "Rendering…" : "Refresh preview"}</Button>
            {previewResult ? (
              <div style={{ marginTop: 12 }}>
                <p><b>{previewResult.subject}</b></p>
                <RichTextView html={previewResult.bodyHtml} />
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
      title={`Send this message to ${selected.length} speaker${selected.length === 1 ? "" : "s"}?`}
      body="This queues a personalized email for every selected speaker. Suppressed and unsubscribed addresses are rechecked and skipped at send time."
      confirmLabel={`Send to ${selected.length}`}
      onConfirm={async () => { if (await runSend()) setConfirmSend(false); }}
      onCancel={() => setConfirmSend(false)}
    />
    </>
  );
}
