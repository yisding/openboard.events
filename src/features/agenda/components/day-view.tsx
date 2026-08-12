"use client";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DndContextProps,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { LayoutGrid } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { EventId, RoomId, ScheduledSessionDTO } from "@/shared/contracts";
import { zonedInputToUtc } from "@/shared/lib/time";
import { EmptyState } from "@/shared/ui/ui-kit";
import { toScheduledSession, detectConflicts } from "../conflicts";
import { DayGridStateProvider, useDayGridActions } from "../hooks/use-day-grid-state";
import { useMoveSession } from "../hooks/use-move-session";
import type { AgendaViewProps } from "../index.client";
import { eventDayKeys, nameLookup, scheduledOnDay, unscheduled } from "../store";
import { DayGrid, parseCellId } from "./day-view/day-grid";
import { agendaDayDndContextId } from "./day-view/dnd-context-id";
import { clampResize, computeGridRange, localWallTimeAt, minutesFromDayStartInZone, pixelDeltaToSlotDelta } from "./day-view/slots";
import { UnscheduledPanel } from "./day-view/unscheduled-panel";

type DragData =
  | { type: "session" | "unscheduled"; session: ScheduledSessionDTO }
  | { type: "resize-start" | "resize-end"; session: ScheduledSessionDTO };

const DEFAULT_FORMAT_DURATION_MINUTES = 30;

type AgendaDayDndContextProps = Omit<DndContextProps, "id"> & {
  eventId: EventId;
  selectedDay: string;
};

/** Small render seam that keeps dnd-kit's SSR id tied to the selected event day. */
export function AgendaDayDndContext({ eventId, selectedDay, ...props }: AgendaDayDndContextProps) {
  return <DndContext {...props} id={agendaDayDndContextId(eventId, selectedDay)} />;
}

/**
 * The Day view — real content per ./M30-day-grid-dnd.md. `agenda-page.tsx`
 * (M28-owned) imports this module by path and hands it the full
 * `AgendaViewProps`; this file and its `day-view/` siblings are the only ones
 * this module edits.
 */
export default function DayView(props: AgendaViewProps) {
  return (
    <DayGridStateProvider>
      <DayViewInner {...props} />
    </DayGridStateProvider>
  );
}

function DayViewInner({ eventId, event, sessions, rooms, tracks, formats, speakers, day, onEdit }: AgendaViewProps) {
  const days = useMemo(
    () => eventDayKeys(event.startsAt, event.endsAt, event.timezone),
    [event.startsAt, event.endsAt, event.timezone],
  );
  // AgendaPage owns this selection so the toolbar, visible grid, URL and
  // create dialog cannot disagree. A null URL still resolves to the first day.
  const selectedDay = day && days.includes(day) ? day : days[0] ?? null;

  const lookup = useMemo(() => nameLookup({ rooms, tracks, formats, speakers }), [rooms, tracks, formats, speakers]);
  const dayScheduled = useMemo(() => scheduledOnDay(sessions, selectedDay, event.timezone), [sessions, selectedDay, event.timezone]);
  const dayUnscheduled = useMemo(() => unscheduled(sessions), [sessions]);
  const range = useMemo(() => computeGridRange(dayScheduled, event.timezone), [dayScheduled, event.timezone]);

  const { setConflicts, setDragging } = useDayGridActions();

  // Recomputed on every session-list change — including the mutation's
  // optimistic patch, which lands in this same `sessions` prop before any
  // server round trip, and again once the server's authoritative response
  // (or a rollback) supersedes it. Never reimplemented here: always M29's
  // `detectConflicts`/`toScheduledSession`.
  useEffect(() => {
    const schedulable = dayScheduled
      .map(toScheduledSession)
      .filter((session): session is NonNullable<typeof session> => session !== null);
    setConflicts(detectConflicts(schedulable));
  }, [dayScheduled, setConflicts]);

  const move = useMoveSession(eventId);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const formatDurationMinutes = (formatId: string | null): number => {
    if (formatId === null) return DEFAULT_FORMAT_DURATION_MINUTES;
    const format = formats.find((candidate) => String(candidate.id) === String(formatId));
    return format?.defaultDurationMins ?? DEFAULT_FORMAT_DURATION_MINUTES;
  };

  const handleDragStart = (dragStart: DragStartEvent) => {
    const data = dragStart.active.data.current as DragData | undefined;
    if (data && (data.type === "session" || data.type === "unscheduled")) setDragging(data.session.id);
  };

  const handleMove = (data: Extract<DragData, { type: "session" | "unscheduled" }>, overId: string) => {
    if (!selectedDay) return;
    const cell = parseCellId(overId);
    if (!cell) return;

    const durationMinutes = data.type === "session" && data.session.startsAt && data.session.endsAt
      ? Math.max(15, Math.round((Date.parse(data.session.endsAt) - Date.parse(data.session.startsAt)) / 60_000))
      : formatDurationMinutes(data.session.formatId);

    // `cell.startMinutes + durationMinutes` can land past midnight — a 60-minute
    // session dropped in a 23:45 slot. `localWallTimeAt` rolls that onto the next
    // day rather than wrapping back to 00:45 of this one.
    const newStartsAt = zonedInputToUtc(localWallTimeAt(selectedDay, cell.startMinutes), event.timezone).toISOString();
    const newEndsAt = zonedInputToUtc(localWallTimeAt(selectedDay, cell.startMinutes + durationMinutes), event.timezone).toISOString();

    move.mutate({
      id: data.session.id,
      version: data.session.rowVersion,
      startsAt: newStartsAt,
      endsAt: newEndsAt,
      roomId: cell.roomId as RoomId | null,
    });
  };

  const handleResize = (edge: "resize-start" | "resize-end", session: ScheduledSessionDTO, deltaPx: number) => {
    if (session.startsAt === null || session.endsAt === null || !selectedDay) return;
    const deltaSlots = pixelDeltaToSlotDelta(deltaPx);
    if (deltaSlots === 0) return; // a jiggle under half a row changes nothing (edge case #5)

    // Both edges are read as wall-clock minutes from the selected day's midnight,
    // never as elapsed UTC time: a session ending at 00:00 the next morning has to
    // come back as 1440 rather than 0 (or clampResize reorders the edges), and a
    // session spanning a DST transition has to keep the end time the grid draws
    // rather than gaining or losing the hour the clock skipped.
    const startMinutes = minutesFromDayStartInZone(session.startsAt, selectedDay, event.timezone);
    const endMinutes = minutesFromDayStartInZone(session.endsAt, selectedDay, event.timezone);
    const next = clampResize(edge === "resize-start" ? "start" : "end", startMinutes, endMinutes, deltaSlots);

    move.mutate({
      id: session.id,
      version: session.rowVersion,
      startsAt: zonedInputToUtc(localWallTimeAt(selectedDay, next.startMinutes), event.timezone).toISOString(),
      endsAt: zonedInputToUtc(localWallTimeAt(selectedDay, next.endMinutes), event.timezone).toISOString(),
      roomId: session.roomId,
    });
  };

  const handleDragEnd = (dragEnd: DragEndEvent) => {
    setDragging(null);
    const data = dragEnd.active.data.current as DragData | undefined;
    if (!data) return;

    if (data.type === "session" || data.type === "unscheduled") {
      // Dropped outside any droppable cell (e.g. released over the unscheduled
      // panel or off the grid entirely) — never destructive, just a no-op.
      if (!dragEnd.over) return;
      handleMove(data, String(dragEnd.over.id));
      return;
    }
    handleResize(data.type, data.session, dragEnd.delta.y);
  };

  return (
    <div className="dv-root">
      {selectedDay === null
        ? (
          <EmptyState
            icon={<LayoutGrid size={26} />}
            title="Set the event's dates"
            description="The day grid needs at least one event day to draw."
          />
        )
        : (
          <AgendaDayDndContext eventId={eventId} selectedDay={selectedDay} sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setDragging(null)}>
            <div className="dv-layout">
              <UnscheduledPanel sessions={dayUnscheduled} lookup={lookup} />
              <div className="dv-scroll">
                <DayGrid
                  sessions={dayScheduled}
                  rooms={rooms}
                  range={range}
                  lookup={lookup}
                  timezone={event.timezone}
                  {...(onEdit ? { onEdit } : {})}
                />
              </div>
            </div>
          </AgendaDayDndContext>
        )}
    </div>
  );
}
