"use client";

import { CalendarDays } from "lucide-react";
import { useMemo } from "react";
import type { ScheduledSessionDTO } from "@/shared/contracts";
import { eventDayKey, formatInZone, zonedInputToUtc } from "@/shared/lib/time";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { Dash } from "@/shared/ui/app/dash";
import { TzTime } from "@/shared/ui/app/tz-time";
import { EmptyState } from "@/shared/ui/ui-kit";
import type { AgendaViewProps } from "../index.client";
import { eventDayKeys, nameLookup } from "../store";
import { AbstractDivergenceChip } from "./abstract-divergence-chip";

/**
 * ./M31-agenda-views.md's Week view: one column per event day, chronological
 * within the column. A list projection, not a pixel-positioned grid — it
 * deliberately does not reuse Day view's grid math (see `../index.client.ts`'s
 * doc comment on why every view gets the same full `AgendaViewProps`).
 *
 * The week projection uses the same half-open event-day boundary as the
 * toolbar and Day view, so an event ending at local midnight cannot gain an
 * empty final column here alone.
 */
export function weekDayKeys(startsAt: string, endsAt: string, timeZone: string): string[] {
  return eventDayKeys(startsAt, endsAt, timeZone);
}

/**
 * The pure half of this view: scheduled sessions bucketed by event day,
 * chronological within each bucket. Exported (alongside `weekDayKeys` above)
 * so `week-view.test.ts` can assert the bucketing rules — every seeded session
 * in its right day, an unscheduled row never appearing anywhere, a null
 * `startsAt` never reaching the sort comparator — without rendering anything.
 */
export function bucketByDay(sessions: readonly ScheduledSessionDTO[], timeZone: string): Map<string, ScheduledSessionDTO[]> {
  const map = new Map<string, ScheduledSessionDTO[]>();
  for (const session of sessions) {
    // Unscheduled rows are List view's and the tray's alone (R10 / the agenda
    // timezone guardrail) — a null `startsAt` never reaches a column here.
    if (session.startsAt === null) continue;
    const key = eventDayKey(session.startsAt, timeZone);
    const bucket = map.get(key);
    if (bucket) bucket.push(session);
    else map.set(key, [session]);
  }
  for (const bucket of map.values()) {
    bucket.sort((left, right) => Date.parse(left.startsAt as string) - Date.parse(right.startsAt as string));
  }
  return map;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

export default function WeekView({ event, sessions, rooms, tracks, formats, speakers }: AgendaViewProps) {
  const lookup = useMemo(() => nameLookup({ rooms, tracks, formats, speakers }), [rooms, tracks, formats, speakers]);
  const days = useMemo(() => weekDayKeys(event.startsAt, event.endsAt, event.timezone), [event.startsAt, event.endsAt, event.timezone]);

  const byDay = useMemo(() => bucketByDay(sessions, event.timezone), [sessions, event.timezone]);

  if (days.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays size={26} />}
        title="No event days yet"
        description="Set the event's start and end dates to see a Week view."
      />
    );
  }

  return (
    <div className="agenda-week">
      {days.map((key) => {
        const label = formatInZone(
          zonedInputToUtc(`${key}T12:00:00`, event.timezone),
          event.timezone,
          { weekday: "short", month: "short", day: "numeric" },
        );
        const items = byDay.get(key) ?? [];
        return (
          <section key={key} className="agenda-week-day">
            <header><b>{label}</b></header>
            {items.length === 0
              ? <p className="agenda-week-empty dash">Nothing scheduled</p>
              : items.map((session) => {
                const track = lookup.track(session.trackId);
                const speakerNames = lookup.speakers(session.speakerIds);
                return (
                  <article key={String(session.id)} className="agenda-week-session">
                    <span className="agenda-week-time">
                      <TzTime instant={session.startsAt} tz={event.timezone} style={{ hour: "numeric", minute: "2-digit" }} />
                      {" – "}
                      <TzTime instant={session.endsAt} tz={event.timezone} style={{ hour: "numeric", minute: "2-digit" }} />
                    </span>
                    <b>{session.title}</b>
                    <AbstractDivergenceChip session={session} />
                    <div className="agenda-week-meta">
                      <Dash value={lookup.room(session.roomId)} />
                      {track && <ColorChip label={track.name} color={track.color} />}
                      {speakerNames.length > 0 && (
                        <span className="agenda-week-speakers" title={speakerNames.join(", ")}>
                          {speakerNames.map(initialsOf).join(", ")}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
          </section>
        );
      })}
    </div>
  );
}
