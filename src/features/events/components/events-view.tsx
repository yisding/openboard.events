import { Plus } from "lucide-react";
import Link from "next/link";
import type { EventDTO } from "@/shared/contracts";
import { Brand } from "@/shared/ui/brand";
import { Button, EmptyState } from "@/shared/ui/ui-kit";
import { EventCard } from "./event-card";
import { SignOutButton } from "@/features/auth/components/sign-out-button";

/** The real, server-backed `/events` list — `listEvents()` rows, no demo store. */
export function EventsView({ events, user }: { events: EventDTO[]; user: { name: string; email: string } }) {
  const accountName = user.name.trim() || user.email;
  const initials = accountName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "OB";
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
          <div className="page-actions">
            <Link href="/events/new" className="button button-primary">
              <Plus size={17} /> Create event
            </Link>
          </div>
        </div>
        {events.length === 0 ? (
          <EmptyState
            icon={<Plus size={22} />}
            title="Create your first event"
            description="An event holds its own tracks, rooms, formats, tags, forms and program."
            action={<Link href="/events/new"><Button>Create event</Button></Link>}
          />
        ) : (
          <div className="event-grid">
            {events.map((event) => <EventCard key={event.id} event={event} />)}
          </div>
        )}
      </section>
    </main>
  );
}
