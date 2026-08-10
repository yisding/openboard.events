"use client";

import { AlertTriangle, CalendarDays, Filter, LayoutGrid, List, MapPin, Plus, Search } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/shared/ui/ui-kit";
import type { AgendaView } from "../store";
import { AGENDA_VIEWS, dayTabLabel, eventDayKeys } from "../store";

const VIEW_LABELS: Record<AgendaView, { label: string; icon: typeof List }> = {
  list: { label: "List", icon: List },
  day: { label: "Day", icon: LayoutGrid },
  week: { label: "Week", icon: CalendarDays },
  track: { label: "Track", icon: Filter },
  room: { label: "Room", icon: MapPin },
  conflicts: { label: "Conflicts", icon: AlertTriangle },
};

/** The views that are about a particular day, and so get the day switcher. */
const DAY_SCOPED: ReadonlySet<AgendaView> = new Set<AgendaView>(["day", "week", "track", "room", "conflicts"]);

/**
 * The one control surface above every view.
 *
 * The Conflicts badge reads the same server-authoritative array that is passed
 * to every view, so M31's Conflicts tab can be rewritten without ever touching
 * this file to keep the count in sync.
 *
 * Day tabs are derived through `eventDayKey` over the event's own start and end
 * instants — never `new Date(...).getDate()`, which would put a 9pm PT session
 * on tomorrow's tab for anybody east of the venue.
 */
export function AgendaToolbar({
  view,
  day,
  conflictCount,
  event,
  search,
  onSearch,
  onView,
  onDay,
  onCreate,
}: {
  view: AgendaView;
  day: string | null;
  conflictCount: number;
  event: { timezone: string; startsAt: string; endsAt: string };
  search: string;
  onSearch: (next: string) => void;
  onView: (next: AgendaView) => void;
  onDay: (next: string | null) => void;
  onCreate: () => void;
}) {
  const days = useMemo(
    () => eventDayKeys(event.startsAt, event.endsAt, event.timezone),
    [event.startsAt, event.endsAt, event.timezone],
  );

  return (
    <>
      <div className="agenda-toolbar">
        <div className="agenda-view-tabs" role="tablist" aria-label="Agenda views">
          {AGENDA_VIEWS.map((candidate) => {
            const { label, icon: Icon } = VIEW_LABELS[candidate];
            return (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={view === candidate}
                className={view === candidate ? "active" : ""}
                onClick={() => onView(candidate)}
              >
                <Icon size={14} aria-hidden />
                {label}
                {candidate === "conflicts" && conflictCount > 0 && <span>{conflictCount}</span>}
              </button>
            );
          })}
        </div>
        <div>
          <label className="table-search">
            <Search size={14} aria-hidden />
            <input
              value={search}
              onChange={(changed) => onSearch(changed.target.value)}
              placeholder="Find session"
              aria-label="Find session"
            />
          </label>
          <Button size="sm" onClick={onCreate}><Plus size={14} aria-hidden /> Add Session</Button>
        </div>
      </div>

      {DAY_SCOPED.has(view) && days.length > 0 && (
        <div className="agenda-daybar">
          <div>
            <button type="button" className={day === null ? "active" : ""} onClick={() => onDay(null)}>
              <span>All</span><b>{days.length}</b><small>days</small>
            </button>
            {days.map((key) => {
              const label = dayTabLabel(key);
              return (
                <button key={key} type="button" className={day === key ? "active" : ""} onClick={() => onDay(key)}>
                  <span>{label.weekday}</span>
                  <b>{label.day}</b>
                  <small>{label.month}</small>
                </button>
              );
            })}
          </div>
          <span>All times {event.timezone}</span>
        </div>
      )}
    </>
  );
}
