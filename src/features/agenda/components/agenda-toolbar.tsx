"use client";

import { AlertTriangle, ArrowRight, CalendarDays, Filter, LayoutGrid, List, MapPin, Plus, Search, UserPlus } from "lucide-react";
import Link from "next/link";
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
 * The Conflicts badge reads the same live derived array that is passed
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
  eventId,
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
  eventId: string;
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
            const hasConflicts = candidate === "conflicts" && conflictCount > 0;
            // First Fair `data-tour`: six tabs, all `role="tab"`, distinguished
            // only by a word and a count. The guided tour's set-piece turns on
            // this one, so it is pinned rather than matched by its text.
            return (
              <button
                key={candidate}
                type="button"
                role="tab"
                {...(candidate === "conflicts" ? { "data-tour": "agenda.conflicts-tab" } : {})}
                aria-selected={view === candidate}
                className={[view === candidate ? "active" : "", hasConflicts ? "has-conflicts" : ""].filter(Boolean).join(" ")}
                onClick={() => onView(candidate)}
              >
                <Icon size={14} aria-hidden />
                {label}
                {candidate === "conflicts" && conflictCount > 0 && <span>{conflictCount}</span>}
              </button>
            );
          })}
        </div>
        <div className="agenda-toolbar-actions">
          <label className="table-search">
            <Search size={14} aria-hidden />
            <input
              value={search}
              onChange={(changed) => onSearch(changed.target.value)}
              placeholder="Find session"
              aria-label="Find session"
            />
          </label>
          {/* #117 — the two off-CFP paths, named, at the moment the organizer
              picks one. "Add Session" schedules a talk that has no abstract and
              never needed one; the link goes to the drawer that files it as an
              abstract instead, which is what you want if it should sit in the
              programme record beside the CFP ones. Nothing on the agenda used
              to mention the second path existed. */}
          <Link className="button button-secondary button-sm agenda-invited-link" href={`/events/${eventId}/abstracts?add=1`}>
            <UserPlus size={14} aria-hidden /> Add invited talk
          </Link>
          <Button size="sm" onClick={onCreate}><Plus size={14} aria-hidden /> Add session</Button>
        </div>
      </div>

      {DAY_SCOPED.has(view) && days.length > 0 && (
        <div className="agenda-daybar">
          <div className="agenda-daybar-scroll" role="group" aria-label="Event day">
            {view !== "day" && (
              <button type="button" aria-pressed={day === null} className={day === null ? "active" : ""} onClick={() => onDay(null)}>
                <span>All</span><b>{days.length}</b><small>days</small>
              </button>
            )}
            {days.map((key) => {
              const label = dayTabLabel(key);
              return (
                <button key={key} type="button" aria-pressed={day === key} className={day === key ? "active" : ""} onClick={() => onDay(key)}>
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
      {conflictCount > 0 && view !== "conflicts" && (
        <button type="button" className="agenda-conflict-banner" onClick={() => onView("conflicts")}>
          <AlertTriangle size={16} aria-hidden="true" />
          <span><b>{conflictCount} scheduling conflict{conflictCount === 1 ? "" : "s"}</b> {conflictCount === 1 ? "needs" : "need"} attention before you publish.</span>
          <strong>Review conflicts <ArrowRight size={14} aria-hidden="true" /></strong>
        </button>
      )}
    </>
  );
}
