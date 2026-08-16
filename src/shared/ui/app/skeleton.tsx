import { cn } from "@/shared/lib/cn";

/**
 * One placeholder block. It carries no size of its own — the caller's class
 * gives it the shape of whatever it stands in for, exactly as the route-level
 * loading states do (`.route-skeleton--title`, `--panel`, `--event-card`).
 */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("route-skeleton", className)} aria-hidden />;
}

/**
 * The placeholder for a block of prose still in flight — a submission's answers,
 * a history feed, a drawer's body.
 *
 * The product loads with skeletons everywhere else (the events hub, the event
 * workspace, every data table), and the handful of surfaces that instead printed
 * "Loading…" read as a different, older application: grey text where the eye
 * expects the shape of the thing arriving, and a panel that jumps when it does.
 *
 * The words are not thrown away, only moved: they stay in the live region as the
 * accessible name, which is where a screen reader wanted them and where a
 * sighted reader never needed them.
 */
export function SkeletonText({ lines = 3, label, className }: { lines?: number; label: string; className?: string }) {
  return (
    <div className={cn("skeleton-text", className)} role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, index) => <Skeleton key={index} className="skeleton-text__line" />)}
    </div>
  );
}
