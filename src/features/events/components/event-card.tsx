import { ArrowRight, CalendarDays, LockKeyhole, MapPin } from "lucide-react";
import Link from "next/link";
import type { EventDTO, MemberRole } from "@/shared/contracts";
import { eventManagementHref } from "@/features/events/access";
import { eventInitials } from "@/shared/lib/event-label";
import { formatDateRangeInZone } from "@/shared/lib/time";
import { StatusBadge } from "@/shared/ui/ui-kit";

/**
 * First Fair (design §5.1) — `isDemo` is deliberately a prop the caller
 * supplies, never a field read off `event` itself: `EventDTO`/`eventDtoSchema`
 * is CP1-frozen, so the org-home listing that knows which event is the demo
 * passes it down explicitly instead of widening the DTO.
 */
export function EventCard({ event, eventRole, isDemo = false }: { event: EventDTO; eventRole: MemberRole | null; isDemo?: boolean }) {
  const managementHref = eventManagementHref(event.id, eventRole);
  return (
    <article className={`event-card${managementHref ? "" : " event-card-locked"}`}>
      {/* The cover carries a monogram, not the name again: printing the name
          in both the cover and the <h2> gave the card two nodes with the same
          text, so the event had no single accessible name and any strict
          by-text lookup matched twice. The <h2> below is now the only one. */}
      <div className="event-cover" aria-hidden="true">
        <div className="event-cover-grid" />
        <span className="event-logo">{eventInitials(event.name, 3)}</span>
      </div>
      <div className="event-card-body">
        <div className="event-card-title">
          <h2>{event.name}</h2>
          {isDemo && <StatusBadge value="demo" />}
        </div>
        <div className="event-meta">
          <span>
            <CalendarDays size={16} />
            {formatDateRangeInZone(event.startsAt, event.endsAt, event.timezone)}
          </span>
          {event.location && (
            <span>
              <MapPin size={16} />
              {event.location}
            </span>
          )}
          <span>/{event.slug}</span>
        </div>
        {managementHref ? (
          <Link href={managementHref} className="button button-secondary event-open">
            {eventRole === "reviewer" ? "Open review queue" : "Open event"} <ArrowRight size={16} />
          </Link>
        ) : (
          <div className="event-access-locked" role="note">
            <LockKeyhole size={16} aria-hidden="true" />
            <span><b>Event access not assigned</b><small>You can see this event in the organization directory. Ask an event owner for access.</small></span>
          </div>
        )}
      </div>
    </article>
  );
}
