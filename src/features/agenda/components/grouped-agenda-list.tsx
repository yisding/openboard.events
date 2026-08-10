"use client";

import { useMemo, type ReactNode } from "react";
import type { RoomDTO, ScheduledSessionDTO, TrackDTO } from "@/shared/contracts";
import { eventDayKey } from "@/shared/lib/time";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { Dash } from "@/shared/ui/app/dash";
import { TzTime } from "@/shared/ui/app/tz-time";
import { dayTabLabel, nameLookup } from "../store";

/**
 * ./M31-agenda-views.md's shared lane renderer for Track and Room — the only
 * two views that group the same scheduled sessions by a different id. Not
 * exported outside this module's own files (`track-view.tsx`/`room-view.tsx`).
 *
 * Every entry in `tracks`/`rooms` gets a lane, even a track with nothing
 * scheduled today (R10: a designed empty note, never an omitted lane), and a
 * trailing "Uncategorized"/"Unassigned" lane always renders for null-grouped
 * sessions plus any session whose group id no longer exists in the vocabulary
 * (a defensive fallback — schema FKs `ON DELETE SET NULL`, so this should not
 * happen — over silently dropping a row).
 */
export type GroupedAgendaListProps = {
  sessions: ScheduledSessionDTO[];
  groupBy: "track" | "room";
  tracks: TrackDTO[];
  rooms: RoomDTO[];
  tz: string;
};

export type Lane = { key: string; item: TrackDTO | RoomDTO | null; sessions: ScheduledSessionDTO[] };

/**
 * `(eventDayKey, startsAt)` ascending. Only ever called on rows already
 * filtered to `startsAt !== null` — the guard here is defensive, per the
 * nullable-render rule, so a null slipping past that filter sorts last rather
 * than throwing.
 */
function laneSort(tz: string) {
  return (left: ScheduledSessionDTO, right: ScheduledSessionDTO): number => {
    if (left.startsAt === null) return 1;
    if (right.startsAt === null) return -1;
    const leftKey = eventDayKey(left.startsAt, tz);
    const rightKey = eventDayKey(right.startsAt, tz);
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
    return Date.parse(left.startsAt) - Date.parse(right.startsAt);
  };
}

/**
 * The pure half of this view: sessions and vocabulary in, lanes out. No React,
 * no DOM — kept separate from the component so `grouped-agenda-list.test.ts`
 * can assert the bucketing rules (every vocabulary entry gets a lane, no
 * session is ever silently dropped, unscheduled rows never appear) without
 * rendering anything.
 */
export function buildLanes(
  sessions: readonly ScheduledSessionDTO[],
  groupBy: "track" | "room",
  tracks: readonly TrackDTO[],
  rooms: readonly RoomDTO[],
  tz: string,
): Lane[] {
  const sort = laneSort(tz);

  // Unscheduled rows belong to List view and the tray only (R10/timezone
  // guardrail) — this filter is the one place that rule is enforced for both
  // Track and Room, since both wrappers share this component.
  const scheduled = sessions.filter((session) => session.startsAt !== null);

  const byKey = new Map<string, ScheduledSessionDTO[]>();
  for (const session of scheduled) {
    const groupId = groupBy === "track" ? session.trackId : session.roomId;
    const key = groupId === null ? "__none__" : String(groupId);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(session);
    else byKey.set(key, [session]);
  }

  const vocabulary: ReadonlyArray<TrackDTO | RoomDTO> = groupBy === "track" ? tracks : rooms;
  const ordered = [...vocabulary].sort((left, right) => left.sortOrder - right.sortOrder);
  const seen = new Set<string>();
  const namedLanes = ordered.map((item): Lane => {
    const key = String(item.id);
    seen.add(key);
    return { key, item, sessions: (byKey.get(key) ?? []).slice().sort(sort) };
  });

  // Anything left — the null bucket, plus any dangling group id not present
  // in the vocabulary above — folds into one trailing lane so no session is
  // ever silently dropped.
  const leftover = [...byKey.entries()]
    .filter(([key]) => !seen.has(key))
    .flatMap(([, group]) => group)
    .sort(sort);
  return [...namedLanes, { key: "__none__", item: null, sessions: leftover }];
}

function LaneRow({ session, tz, groupBy, other }: {
  session: ScheduledSessionDTO;
  tz: string;
  groupBy: "track" | "room";
  other: { roomName: string | null; track: TrackDTO | null };
}) {
  const dayKey = session.startsAt === null ? null : eventDayKey(session.startsAt, tz);
  const dayLabel = dayKey ? dayTabLabel(dayKey) : null;
  return (
    <div className="agenda-lane-row">
      <div className="agenda-lane-time">
        {dayLabel && <span className="agenda-day-chip">{dayLabel.weekday} {dayLabel.day}</span>}
        <TzTime instant={session.startsAt} tz={tz} style={{ hour: "numeric", minute: "2-digit" }} />
        {" – "}
        <TzTime instant={session.endsAt} tz={tz} style={{ hour: "numeric", minute: "2-digit" }} />
      </div>
      <b>{session.title}</b>
      <div className="agenda-lane-meta">
        {groupBy === "track"
          ? <Dash value={other.roomName} />
          : (other.track ? <ColorChip label={other.track.name} color={other.track.color} /> : <Dash />)}
      </div>
    </div>
  );
}

export function GroupedAgendaList({ sessions, groupBy, tracks, rooms, tz }: GroupedAgendaListProps) {
  const lookup = useMemo(() => nameLookup({ rooms, tracks }), [rooms, tracks]);
  const lanes = useMemo(
    () => buildLanes(sessions, groupBy, tracks, rooms, tz),
    [sessions, groupBy, tracks, rooms, tz],
  );

  return (
    <div className="agenda-lanes">
      {lanes.map((lane) => {
        const header: ReactNode = lane.item === null
          ? <span className="dash">{groupBy === "track" ? "Uncategorized" : "Unassigned"}</span>
          : groupBy === "track"
            ? <ColorChip label={(lane.item as TrackDTO).name} color={(lane.item as TrackDTO).color} />
            : (
              <span>
                <b>{(lane.item as RoomDTO).name}</b>
                <small><Dash value={(lane.item as RoomDTO).capacity}>{(lane.item as RoomDTO).capacity} seats</Dash></small>
              </span>
            );
        return (
          <section key={lane.key} className="agenda-lane">
            <header>
              {header}
              <span className="agenda-lane-count">{lane.sessions.length}</span>
            </header>
            {lane.sessions.length === 0
              ? <p className="agenda-lane-empty dash">Nothing scheduled</p>
              : lane.sessions.map((session) => (
                <LaneRow
                  key={String(session.id)}
                  session={session}
                  tz={tz}
                  groupBy={groupBy}
                  other={{ roomName: lookup.room(session.roomId), track: lookup.track(session.trackId) }}
                />
              ))}
          </section>
        );
      })}
    </div>
  );
}
