import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import type { EventDTO } from "@/shared/contracts";
import { eventInitials } from "@/shared/lib/event-label";
import { formatInZone } from "@/shared/lib/time";

export function EventCard({ event }: { event: EventDTO }) {
  return (
    <article className="event-card">
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
        </div>
        <div className="event-meta">
          <span>
            <CalendarDays size={16} />
            {formatInZone(event.startsAt, event.timezone, "date")} – {formatInZone(event.endsAt, event.timezone, "date")}
          </span>
          {event.location && (
            <span>
              <MapPin size={16} />
              {event.location}
            </span>
          )}
          <span>/{event.slug}</span>
        </div>
        <Link href={`/events/${event.id}/dashboard`} className="button button-secondary event-open">
          Open event <ArrowRight size={16} />
        </Link>
      </div>
    </article>
  );
}
