import { Plus } from "lucide-react";
import Link from "next/link";
import type { EventAccessDTO } from "@/shared/contracts";
import { Brand } from "@/shared/ui/brand";
import { Button, EmptyState } from "@/shared/ui/ui-kit";
import { EventCard } from "./event-card";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { groupEventsByLifecycle } from "../event-lifecycle";

function EventGrid({ events }: { events: EventAccessDTO[] }) {
  return <div className="event-grid">{events.map((event) => <EventCard key={event.id} event={event} eventRole={event.role} />)}</div>;
}

/** The real, server-backed `/events` list — `listEvents()` rows, no demo store. */
export function EventsView({ events, user, createHref, hasOrganizations, nowIso = new Date().toISOString() }: { events: EventAccessDTO[]; user: { name: string; email: string }; createHref: string | null; hasOrganizations: boolean; nowIso?: string }) {
  const accountName = user.name.trim() || user.email;
  const initials = accountName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "OB";
  const grouped = groupEventsByLifecycle(events, nowIso);
  const hasActiveWork = grouped.current.length + grouped.upcoming.length > 0;
  return (
    <main className="events-index">
      <header className="events-index-header">
        <Brand dark />
        <div>
          <SignOutButton kind="admin" />
          <span className="header-avatar" aria-label={`Signed in as ${accountName}`} title={accountName}>{initials}</span>
        </div>
      </header>
      <section className="events-index-content">
        <div className="events-title">
          <div>
            <div className="page-eyebrow">Workspace</div>
            <h1>Your events</h1>
            <p>Choose an event to continue managing your program.</p>
          </div>
          {createHref && <div className="page-actions">
            <Link href={createHref} className="button button-primary">
              <Plus size={17} /> Create event
            </Link>
          </div>}
        </div>
        {events.length === 0 ? (
          <EmptyState
            icon={<Plus size={22} />}
            title={createHref ? "Create your first event" : "No events assigned"}
            description={createHref
              ? "An event holds its own tracks, rooms, formats, tags, forms and program."
              : hasOrganizations
                ? "You have workspace access, but no events are assigned to you yet."
                : "Ask an administrator to add you to an organization and assign an event."}
            action={createHref
              ? <Link href={createHref}><Button>Create event</Button></Link>
              : hasOrganizations
                ? <Link href="/organizations"><Button variant="secondary">View organization directory</Button></Link>
                : undefined}
          />
        ) : (
          <div className="event-lifecycle-groups">
            {grouped.current.length > 0 && <section aria-labelledby="current-events-heading"><h2 id="current-events-heading">Happening now</h2><EventGrid events={grouped.current} /></section>}
            {grouped.upcoming.length > 0 && <section aria-labelledby="upcoming-events-heading"><h2 id="upcoming-events-heading">Upcoming</h2><EventGrid events={grouped.upcoming} /></section>}
            {grouped.past.length > 0 && (
              <details className="past-events" open={!hasActiveWork}>
                <summary>Past events <span>{grouped.past.length}</span></summary>
                <EventGrid events={grouped.past} />
              </details>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
