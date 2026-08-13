"use client";

import { Copy, FlaskConical } from "lucide-react";
import { useMemo } from "react";
import type { CommLogId, EventId } from "@/shared/contracts";
import { Dash } from "@/shared/ui/app/dash";
import { Button, Drawer, StatusBadge } from "@/shared/ui/ui-kit";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { TzTime } from "@/shared/ui/app/tz-time";
import { useToast } from "@/shared/ui/toast";
import { useCommLogDetail } from "../hooks/use-comm-log";

function firstLink(html: string): string | null {
  const match = html.match(/href="([^"]+)"/u);
  return match?.[1] ?? null;
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
            <div><dt>Template</dt><dd>{detail.templateKey.replaceAll("_", " ")}</dd></div>
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
            <span>SUBJECT</span>
            <h2>{detail.subjectRendered ?? <Dash />}</h2>
            {copyableLink && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { void navigator.clipboard.writeText(copyableLink); toast("Link copied"); }}
              >
                <Copy size={14} /> Copy link (preview only)
              </Button>
            )}
            <div className="rendered-email">
              {detail.bodyRenderedHtml ? <RichTextView html={detail.bodyRenderedHtml} /> : <p className="long-copy">Body not captured.</p>}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}
