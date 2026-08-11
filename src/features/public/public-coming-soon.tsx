import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * M60 — "guided empty states fleet-wide" + "the 404, 'schedule not yet
 * published', empty search — a helpful redirect ... reads as craft"
 * (experience-design.md). One shared shell; each public surface supplies its
 * own copy and its own cross-link to whichever sibling surface already has
 * something to show, rather than every "coming soon" being a dead end.
 */
export function PublicComingSoon({
  icon: Icon,
  title,
  description,
  linkHref,
  linkLabel,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  linkHref?: string;
  linkLabel?: string;
}) {
  return (
    <div className="public-empty">
      <Icon size={24} />
      <h3>{title}</h3>
      <p>{description}</p>
      {linkHref && linkLabel && <Link className="button button-secondary" href={linkHref}>{linkLabel}</Link>}
    </div>
  );
}
