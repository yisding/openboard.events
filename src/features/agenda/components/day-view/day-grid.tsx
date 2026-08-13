"use client";

import { useDroppable } from "@dnd-kit/core";
import { useMemo } from "react";
import type { RoomDTO, ScheduledSessionDTO } from "@/shared/contracts";
import type { NameLookup } from "../../store";
import { SessionCard } from "./session-card";
import {
  gridRowCount,
  minutesFromDayStartInZone,
  minutesToGridRow,
  SLOT_MINUTES,
  SLOT_ROW_HEIGHT_PX,
  type GridRange,
} from "./slots";

/** Encodes a droppable cell's room + 15-minute slot start so a drop resolves to an exact time. */
export function cellId(roomId: string | null, startMinutes: number): string {
  return `dv-cell:${roomId ?? "none"}:${startMinutes}`;
}

export function parseCellId(id: string): { roomId: string | null; startMinutes: number } | null {
  const match = /^dv-cell:([^:]*):(-?\d+)$/.exec(id);
  if (!match) return null;
  const [, rawRoom, rawMinutes] = match;
  const roomId = rawRoom === undefined || rawRoom === "none" ? null : rawRoom;
  return { roomId, startMinutes: Number(rawMinutes ?? "0") };
}

function DroppableCell({
  roomId, startMinutes, row, column,
}: { roomId: string | null; startMinutes: number; row: number; column: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: cellId(roomId, startMinutes), data: { roomId, startMinutes } });
  return <div ref={setNodeRef} className={isOver ? "dv-cell dv-cell--over" : "dv-cell"} style={{ gridRow: row, gridColumn: column }} />;
}

function hourLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60) % 24;
  const suffix = hour < 12 ? "AM" : "PM";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

/**
 * The room x time grid: one continuous droppable cell per (room, 15-minute
 * slot), with session cards layered on top via the same CSS grid coordinates.
 * The cells never need to be visually distinct from each other — they only
 * exist so dnd-kit's collision detection can resolve a drop to an exact
 * room + 15-minute-aligned time.
 */
export function DayGrid({
  sessions,
  rooms,
  range,
  day,
  lookup,
  timezone,
  onEdit,
}: {
  sessions: ScheduledSessionDTO[];
  rooms: RoomDTO[];
  range: GridRange;
  day: string;
  lookup: NameLookup;
  timezone: string;
  onEdit?: (id: string) => void;
}) {
  const rowCount = gridRowCount(range);

  const hourLabels = useMemo(() => {
    const labels: { row: number; label: string }[] = [];
    for (let minutes = range.gridStartMinutes; minutes < range.gridEndMinutes; minutes += 60) {
      labels.push({ row: minutesToGridRow(minutes, range.gridStartMinutes), label: hourLabel(minutes) });
    }
    return labels;
  }, [range]);

  const cells = useMemo(() => {
    const built: { key: string; roomId: string; startMinutes: number; row: number; column: number }[] = [];
    rooms.forEach((room, roomIndex) => {
      for (let minutes = range.gridStartMinutes; minutes < range.gridEndMinutes; minutes += SLOT_MINUTES) {
        built.push({
          key: `${room.id}-${minutes}`,
          roomId: String(room.id),
          startMinutes: minutes,
          row: minutesToGridRow(minutes, range.gridStartMinutes),
          column: roomIndex + 2,
        });
      }
    });
    return built;
  }, [rooms, range]);

  const roomIds = useMemo(() => new Set(rooms.map((room) => String(room.id))), [rooms]);
  const placed = useMemo(() => sessions.filter((session) =>
    session.startsAt !== null
    && session.endsAt !== null
    && session.roomId !== null
    && roomIds.has(String(session.roomId))), [sessions, roomIds]);

  return (
    <div
      className="dv-grid"
      style={{
        gridTemplateColumns: `56px repeat(${Math.max(rooms.length, 1)}, minmax(160px, 1fr))`,
        gridTemplateRows: `40px repeat(${rowCount}, ${SLOT_ROW_HEIGHT_PX}px)`,
      }}
    >
      <div className="dv-grid-corner" style={{ gridRow: 1, gridColumn: 1 }} />
      {rooms.map((room, index) => (
        <div key={String(room.id)} className="dv-room-header" style={{ gridRow: 1, gridColumn: index + 2 }}>{room.name}</div>
      ))}

      {hourLabels.map(({ row, label }) => (
        <div key={`${label}-${row}`} className="dv-hour-label" style={{ gridRow: row + 1, gridColumn: 1 }}>{label}</div>
      ))}

      {cells.map((cell) => (
        <DroppableCell key={cell.key} roomId={cell.roomId} startMinutes={cell.startMinutes} row={cell.row + 1} column={cell.column} />
      ))}

      {placed.map((session) => {
        const roomIndex = rooms.findIndex((room) => String(room.id) === String(session.roomId));
        if (roomIndex === -1) return null; // Defensive: Day view also exposes this row in Needs a room.
        // Anchored to the rendered day, not to bare minutes-since-midnight: an
        // evening session ending after local midnight reads its end as 00:30 ->
        // 30 otherwise, which is *below* its start and resolves to a nonsense
        // (often negative) CSS grid line. Past 1440 the clamp below pins the
        // card to the grid's last row instead.
        const startMinutes = minutesFromDayStartInZone(session.startsAt as string, day, timezone);
        const endMinutes = minutesFromDayStartInZone(session.endsAt as string, day, timezone);
        const startRow = Math.max(1, minutesToGridRow(startMinutes, range.gridStartMinutes)) + 1;
        const endRow = Math.min(rowCount + 1, minutesToGridRow(endMinutes, range.gridStartMinutes)) + 1;
        return (
          <SessionCard
            key={String(session.id)}
            session={session}
            roomIndex={roomIndex}
            startRow={startRow}
            endRow={endRow}
            track={lookup.track(session.trackId)}
            speakerNames={lookup.speakers(session.speakerIds)}
            timezone={timezone}
            {...(onEdit ? { onEdit } : {})}
          />
        );
      })}
    </div>
  );
}
