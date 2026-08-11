import { cn } from "@/shared/lib/cn";

/**
 * A track, format or tag label. Rendering is two-tier, by design (see
 * `tightening-audit-color-restraint.md` Finding C): pass `color` only on the
 * schedule/agenda surfaces where organizer-chosen track colour is the primary
 * scan mechanism (`week-view.tsx`, `day-view/session-card.tsx`,
 * `list-view.tsx`, `grouped-agenda-list.tsx`) — there it tints both
 * background and text. Everywhere else (`abstracts-table.tsx`,
 * `plans-view.tsx`, the portal submission list/detail) omit `color` and this
 * renders as the plain neutral `.track-chip` — a dense table already has a
 * `StatusBadge` and a rating column doing the real signaling, and a third
 * independent colour system competes rather than helps.
 */
export function ColorChip({ label, color, className }: { label: string; color?: string | null; className?: string }) {
  const style = color ? { background: `${color}1f`, color } : undefined;
  return (
    <span className={cn("track-chip", className)} {...(style ? { style } : {})}>
      {label}
    </span>
  );
}
