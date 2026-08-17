"use client";

import { Copy, FlaskConical } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { CommLogId, EventId } from "@/shared/contracts";
import { Dash } from "@/shared/ui/app/dash";
import { templateLabel } from "@/shared/ui/template-label";
import { Button, Drawer, StatusBadge } from "@/shared/ui/ui-kit";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { TzTime } from "@/shared/ui/app/tz-time";
import { useToast } from "@/shared/ui/toast";
import { useCommLogDetail } from "../hooks/use-comm-log";
import type { CommLogDetailWithFlag } from "../schemas";
import { MessageFormatToggle, type MessageFormat } from "./message-format-toggle";

function firstLink(html: string): string | null {
  const match = html.match(/href="([^"]+)"/u);
  return match?.[1] ?? null;
}

/**
 * What to say where the body would be. A row the dispatcher stopped before
 * `renderTemplateContent` has neither subject nor body — every send on a demo
 * event is one — and "Body not captured." alone reads like data loss. The
 * `error` column already holds the answer (`SkipEmail`'s reason), so the
 * placeholder says it out loud rather than making the organizer join the two
 * fields themselves.
 *
 * Only a `skipped` row earns the claim: every skip lands before the dispatcher
 * persists the render, so "never rendered" is a fact there. A missing body on
 * any other status proves nothing — the 90-day retention job
 * (`data-lifecycle/server/retention.ts`) redacts the body of rows that
 * rendered fine while keeping `error`, and a queued retry may still render on
 * its next attempt. Those fall back to the plain line; the Error row beneath
 * still shows the failure itself.
 */
function bodyPlaceholder(detail: CommLogDetailWithFlag): string {
  if (detail.status === "skipped" && detail.error) {
    return `Skipped before this message was rendered, so there is no body to show (${detail.error}).`;
  }
  return "Body not captured.";
}

/**
 * Step 6's audit surface. `<RichTextView>` is the repo's only unsafe-HTML
 * render site (CI greps for uniqueness), so the body renders through that
 * shared component, never inline.
 *
 * `body_rendered_html` arrives already redacted where it needs to be (M34's
 * dispatcher does that at storage time): a `portal_login` row outside preview
 * fallback shows `[redacted]` in place of the code and the link, so there is
 * nothing left for this sheet to strip — "no Copy-link action" falls out of
 * there being no live link in the stored HTML to copy.
 */
export function LogDetailSheet({ eventId, logId, timezone, onClose }: { eventId: EventId; logId: CommLogId | null; timezone: string; onClose: () => void }) {
  const { toast } = useToast();
  const query = useCommLogDetail(eventId, logId);
  const detail = query.data;
  const bodyId = useId();
  const [format, setFormat] = useState<MessageFormat>("html");
  // Templates and bulk compose both offer the text alternative beside the
  // rendered body; the audit surface is where "what did they actually get?"
  // matters most, so it offers the same two views of the same stored message.
  const hasPlainText = typeof detail?.bodyRenderedText === "string";
  const activeFormat = hasPlainText ? format : "html";
  const copyableLink = useMemo(() => {
    if (!detail?.bodyRenderedHtml || !detail.previewFallback) return null;
    return firstLink(detail.bodyRenderedHtml);
  }, [detail]);

  return (
    <Drawer open={logId !== null} onClose={onClose} title="Message detail">
      {query.isLoading && <p className="long-copy">Loading…</p>}
      {query.isError && <p className="long-copy">This message couldn&apos;t be loaded.</p>}
      {detail && (
        <div className="comm-detail">
          <div className="comm-detail-status">
            <StatusBadge value={detail.status} />
            {detail.previewFallback && (
              <span className="preview-fallback-badge"><FlaskConical size={12} /> Preview diagnostics — not judge-path evidence</span>
            )}
          </div>
          <dl>
            <div><dt>Recipient</dt><dd>{detail.recipientName} &lt;{detail.recipientEmail}&gt;</dd></div>
            <div><dt>Template</dt><dd>{templateLabel(detail.templateKey)}</dd></div>
            <div><dt>Created</dt><dd><TzTime instant={detail.createdAt} tz={timezone} style="dateTime" /></dd></div>
            <div><dt>Sent</dt><dd><TzTime instant={detail.sentAt} tz={timezone} style="dateTime" /></dd></div>
            <div><dt>Provider ID</dt><dd><Dash value={detail.providerMessageId} /></dd></div>
            <div><dt>ICS UID</dt><dd><Dash value={detail.icsUid} /></dd></div>
            <div><dt>Idempotency key</dt><dd className="mono-cell">{detail.idempotencyKey}</dd></div>
            <div><dt>Attempts</dt><dd>{detail.attempts}</dd></div>
            {detail.error && (
              <div><dt>Error</dt><dd className="log-error-cell" title={detail.error}>{detail.error}</dd></div>
            )}
          </dl>
          {detail.templateKey === "portal_login" && !detail.previewFallback && (
            <p className="pinned-note">Production credentials are redacted in this log — the sign-in code and link never render here.</p>
          )}
          <section>
            <div className="comm-detail-body-head">
              <div>
                <span>SUBJECT</span>
                <h2>{detail.subjectRendered ?? (detail.status === "skipped" && detail.error ? <span className="log-unrendered-cell">Not rendered</span> : <Dash />)}</h2>
              </div>
              {hasPlainText && (
                <MessageFormatToggle
                  format={activeFormat}
                  label="Message format"
                  htmlPanelId={`${bodyId}-html`}
                  textPanelId={`${bodyId}-text`}
                  onChange={setFormat}
                />
              )}
            </div>
            {copyableLink && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { void navigator.clipboard.writeText(copyableLink); toast("Link copied"); }}
              >
                <Copy size={14} /> Copy link (preview only)
              </Button>
            )}
            <div id={`${bodyId}-html`} className="rendered-email" hidden={activeFormat !== "html"}>
              {detail.bodyRenderedHtml ? <RichTextView html={detail.bodyRenderedHtml} /> : <p className="long-copy">{bodyPlaceholder(detail)}</p>}
            </div>
            {hasPlainText && (
              <div id={`${bodyId}-text`} className="rendered-email template-preview-plain-text" hidden={activeFormat !== "text"}>
                <pre>{detail.bodyRenderedText || "(empty plain-text body)"}</pre>
              </div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
