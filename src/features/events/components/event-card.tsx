import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import Link from "next/link";
import type { EventDTO } from "@/shared/contracts";
import { formatInZone } from "@/shared/lib/time";

export function EventCard({ event }: { event: EventDTO }) {
  return (
    <article className="event-card">
      <div className="event-cover">
        <div className="event-cover-grid" />
        <span className="event-logo">{event.name}</span>
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
