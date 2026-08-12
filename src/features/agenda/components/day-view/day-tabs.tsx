"use client";

import { useMemo } from "react";
import { dayTabLabel, eventDayKeys } from "../../store";

/**
 * The Day view's own day switcher, driven by `eventDayKey` over the event's
 * start/end instants (never a bare `Date` method) so a session that lands late
 * in the evening for the venue's zone never shows up under tomorrow's tab for
 * an admin sitting in another one.
 *
 * AgendaPage owns the active day. Both this inner strip and the toolbar update
 * that state and the URL together, so the grid and session-create dialog always
 * agree about which day the organizer is looking at.
 */
export function DayTabs({
  event,
  selected,
  onSelect,
}: {
  event: { startsAt: string; endsAt: string; timezone: string };
  selected: string | null;
  onSelect: (day: string) => void;
}) {
  const days = useMemo(
    () => eventDayKeys(event.startsAt, event.endsAt, event.timezone),
    [event.startsAt, event.endsAt, event.timezone],
  );

  if (days.length === 0) return null;

  return (
    <div className="dv-day-tabs" role="tablist" aria-label="Day">
      {days.map((key) => {
        const label = dayTabLabel(key);
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={selected === key}
            className={selected === key ? "active" : ""}
            onClick={() => onSelect(key)}
          >
            <span>{label.weekday}</span>
            <b>{label.day}</b>
            <small>{label.month}</small>
          </button>
        );
      })}
    </div>
  );
}
