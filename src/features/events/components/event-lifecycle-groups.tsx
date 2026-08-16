"use client";

import { useEffect, useState } from "react";
import type { EventAccessDTO } from "@/shared/contracts";
import { groupEventsByLifecycle, nextEventLifecycleRefreshMs } from "../event-lifecycle";
import { EventCard } from "./event-card";

function EventGrid({ events }: { events: EventAccessDTO[] }) {
  return <div className="event-grid">{events.map((event) => <EventCard key={event.id} event={event} eventRole={event.role} isDemo={event.isDemo} />)}</div>;
}

export function EventLifecycleGroups({ events, nowIso }: { events: EventAccessDTO[]; nowIso: string }) {
  const [lifecycleNowIso, setLifecycleNowIso] = useState(nowIso);

  useEffect(() => {
    let timer: number | null = null;
    const refresh = () => {
      const nowMs = Date.now();
      setLifecycleNowIso(new Date(nowMs).toISOString());
      const delay = nextEventLifecycleRefreshMs(events, nowMs);
      if (delay !== null) timer = window.setTimeout(refresh, delay);
    };
    refresh();
    return () => { if (timer !== null) window.clearTimeout(timer); };
  }, [events]);

  const grouped = groupEventsByLifecycle(events, lifecycleNowIso);
  const hasActiveWork = grouped.current.length + grouped.upcoming.length > 0;

  return (
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
  );
}
