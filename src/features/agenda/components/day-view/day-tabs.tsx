"use client";

import { useMemo } from "react";
import { dayTabLabel, eventDayKeys } from "../../store";

/**
 * The Day view's own day switcher, driven by `eventDayKey` over the event's
 * start/end instants (never a bare `Date` method) so a session that lands late
 * in the evening for the venue's zone never shows up under tomorrow's tab for
 * an admin sitting in another one.
 *
 * `AgendaViewProps` carries no day-navigation callback — the toolbar's own day
 * bar (`agenda-toolbar.tsx`, M28-owned) drives the `?day=` URL param for every
 * day-scoped view uniformly. This module is a leaf surface that never edits
 * that file, so its own tab strip keeps local selection state, seeded from
 * `props.day` when the toolbar has one and defaulting to the event's first day
 * otherwise — the grid always has a concrete day to lay sessions out against.
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
