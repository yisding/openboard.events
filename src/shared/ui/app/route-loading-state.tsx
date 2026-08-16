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

export function EventWorkspaceLoading() {
  return (
    <section className="route-workspace-loading" aria-busy="true">
      <p className="sr-only" role="status">Loading this event workspace…</p>
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
        <Skeleton className="route-skeleton--panel" />
        <Skeleton className="route-skeleton--panel" />
      </div>
    </section>
  );
}
