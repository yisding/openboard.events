"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { usePathname } from "next/navigation";

/**
 * The way back into the portal from a boundary that has no portal context to
 * read — the slug comes from the pathname, the same way `portal/error.tsx`
 * recovers it. Falls back to the product home only when the URL carries no
 * event at all, which is the one case where there is no portal to return to.
 */
export function PortalExitLinks() {
  const eventSlug = usePathname().split("/")[2];
  if (!eventSlug) return <Link href="/" className="button button-primary"><ArrowLeft size={16} /> Back to Openboard</Link>;
  const base = `/portal/${encodeURIComponent(eventSlug)}`;
  return (
    <div className="not-found-actions">
      <Link href={base} className="button button-primary"><ArrowLeft size={16} /> Back to the speaker portal</Link>
      <Link href={`${base}/resources`} className="button button-secondary">Browse resources</Link>
    </div>
  );
}
