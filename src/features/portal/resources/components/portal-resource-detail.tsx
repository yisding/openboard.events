import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import type { ResourcePageDTO } from "../server/queries";

/**
 * The one place `bodyHtml` is rendered — through `<RichTextView wide>`, which
 * runs it back through `sanitize(html, {profile:'wide'})` even though the
 * mutation already sanitized it on save (belt + braces, per the work order's
 * guardrail). No other prop is available to widen the allowlist further; this
 * is the sole consumer of the `wide` profile outside `sanitize.ts` itself.
 */
export function ResourcePageDetailView({ eventSlug, page }: { eventSlug: string; page: ResourcePageDTO }) {
  return (
    <div className="portal-container resource-detail-page">
      <Link href={`/portal/${eventSlug}/resources`}><ArrowLeft size={15} /> All resources</Link>
      <article>
        <span className="public-eyebrow">SPEAKER RESOURCE</span>
        <h1>{page.title}</h1>
        {page.summary && <p className="resource-summary">{page.summary}</p>}
        <RichTextView html={page.bodyHtml ?? ""} wide />
        <div className="resource-contact">
          <b>Still have a question?</b>
          <p>Our speaker success team is happy to help.</p>
          <a href="mailto:speakers@openboard.dev">Contact speaker support</a>
        </div>
      </article>
    </div>
  );
}
