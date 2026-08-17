import Link from "next/link";
import { Brand } from "@/shared/ui/brand";
import { Skeleton } from "@/shared/ui/app/skeleton";

export function EventsHubLoading() {
  return (
    <main className="events-index" aria-busy="true">
      <p className="sr-only" role="status">Loading your events…</p>
      <header className="events-index-header">
        <Brand dark />
        <Skeleton className="route-skeleton--avatar" />
      </header>
      <section className="events-index-content">
        <div className="events-title route-loading-title">
          <div>
            <Skeleton className="route-skeleton--eyebrow" />
            <Skeleton className="route-skeleton--title" />
            <Skeleton className="route-skeleton--copy" />
          </div>
          <Skeleton className="route-skeleton--button" />
        </div>
        <div className="event-grid" aria-hidden>
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="route-skeleton--event-card" />)}
        </div>
      </section>
    </main>
  );
}

/**
 * The body every `PageHeader` + panels route loads into: a title block and the
 * panels beneath it. `layout="single"` is for the surfaces that carry one
 * panel rather than a grid of them — a two-column shimmer over a page that
 * resolves to a single list reads as content that never arrived.
 */
function WorkspaceLoading({ label, layout = "grid" }: { label: string; layout?: "grid" | "single" }) {
  return (
    <section className="route-workspace-loading" aria-busy="true">
      <p className="sr-only" role="status">{label}</p>
      <header>
        <div>
          <Skeleton className="route-skeleton--eyebrow" />
          <Skeleton className="route-skeleton--title" />
          <Skeleton className="route-skeleton--copy" />
        </div>
        <Skeleton className="route-skeleton--button" />
      </header>
      <div className="route-workspace-loading__grid" aria-hidden>
        <Skeleton className="route-skeleton--panel route-skeleton--panel-wide" />
        {layout === "grid" && <>
          <Skeleton className="route-skeleton--panel" />
          <Skeleton className="route-skeleton--panel" />
        </>}
      </div>
    </section>
  );
}

export function EventWorkspaceLoading() {
  return <WorkspaceLoading label="Loading this event workspace…" />;
}

/**
 * M44/M45 admin surfaces outside an event. `organizations/[organizationId]`
 * and `account` each render this *inside* their layout, so the branded header
 * is already on screen and only the content area shimmers.
 */
export function OrganizationWorkspaceLoading() {
  return <WorkspaceLoading label="Loading this organization…" />;
}

export function AccountLoading() {
  return <WorkspaceLoading label="Loading your account…" layout="single" />;
}

/**
 * `/organizations` has no layout of its own — the chooser page and
 * `[organizationId]/layout.tsx` each draw the shell themselves — so the
 * boundary that stands in for the whole subtree has to draw it too, otherwise
 * the first paint of an organization page is a bare canvas. The header is real
 * rather than skeletal: it is the same static chrome either layout would
 * render, and nothing is gained by making the reader wait for a logo.
 */
export function OrganizationsHubLoading() {
  return (
    <main className="events-index">
      <header className="events-index-header">
        <Brand dark />
        <Link href="/events" className="header-help">Back to events</Link>
      </header>
      <section className="events-index-content">
        <WorkspaceLoading label="Loading your organizations…" />
      </section>
    </main>
  );
}
