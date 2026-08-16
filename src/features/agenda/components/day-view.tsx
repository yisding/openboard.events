"use client";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type Active,
  type Announcements,
  type DndContextProps,
  type DragEndEvent,
  type Over,
} from "@dnd-kit/core";
import { LayoutGrid, MapPin } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { EventId, RoomId, ScheduledSessionDTO } from "@/shared/contracts";
import { wallTimeExistsInZone, zonedInputToUtc } from "@/shared/lib/time";
import { useToast } from "@/shared/ui/toast";
import { EmptyState } from "@/shared/ui/ui-kit";
import { toScheduledSession, detectConflicts } from "../conflicts";
import { DayGridStateProvider, useDayGridActions } from "../hooks/use-day-grid-state";
import { useMoveSession } from "../hooks/use-move-session";
import { agendaKeys } from "../hooks/keys";
import type { AgendaViewProps } from "../index.client";
import { eventDayKeys, nameLookup, scheduledNeedingRoom, scheduledOnDay, unscheduled } from "../store";
import { DayGrid, parseCellId } from "./day-view/day-grid";
import { agendaDayDndContextId } from "./day-view/dnd-context-id";
import { clampResize, computeGridRange, localWallTimeAt, minutesFromDayStartInZone, pixelDeltaToSlotDelta, slotTimeLabel, wallClockDurationMinutes } from "./day-view/slots";
import { NeedsRoomPanel, UnscheduledPanel } from "./day-view/unscheduled-panel";
import { AutoPlaceDialog } from "./auto-place-dialog";

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

function DayViewInner({ eventId, event, sessions, rooms, tracks, formats, speakers, day, unscheduledTotal, onEdit }: AgendaViewProps) {
  const queryClient = useQueryClient();
  const [autoPlaceOpen, setAutoPlaceOpen] = useState(false);
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
  const needsRoom = useMemo(() => scheduledNeedingRoom(dayScheduled, rooms), [dayScheduled, rooms]);
  const range = useMemo(
    () => computeGridRange(dayScheduled, selectedDay, event.timezone),
    [dayScheduled, selectedDay, event.timezone],
  );

  const { setConflicts } = useDayGridActions();

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

  // `rooms` so a drop into an undersized room says so in its own move toast.
  const move = useMoveSession(eventId, rooms);
  const { toast } = useToast();

  /**
   * A spring-forward date has an hour of local clock that never happens, and the
   * grid still draws its rows. `zonedInputToUtc` resolves a skipped wall time
   * *backwards* to the pre-transition offset, so writing one silently places the
   * session an hour before the cell the organizer aimed at — or, when only one
   * edge lands in the gap, produces `endsAt < startsAt` and the move round-trips
   * to the server just to be rejected with a generic failure.
   *
   * Refuse instead, with the reason. `DateTimePicker` already disables Apply on
   * exactly this condition (`localDateTimeExists`); the grid is the one path
   * that wrote through. Nothing is lost by refusing: that hour does not exist,
   * so nothing can be scheduled inside it either way.
   */
  const rejectSkippedWallTime = (...localTimes: string[]): boolean => {
    if (localTimes.every((local) => wallTimeExistsInZone(local, event.timezone))) return false;
    toast("That time does not exist because the clock changes on this date");
    return true;
  };

  // Pointer only, deliberately: a 15-minute-slot grid cannot be driven usefully
  // by dnd-kit's default 25px keyboard steps, so the keyboard route to
  // rescheduling is the session dialog's room select and date-time pickers. The
  // cards and tray rows therefore do not spread dnd-kit's draggable attributes,
  // which would otherwise advertise a space-bar pickup that does nothing — see
  // `session-card.tsx` and `day-view/unscheduled-panel.tsx`.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  // Whether the resize that just ended actually wrote anything. dnd-kit hands
  // the announcement callbacks `{active, over}` and no delta, but `DndContext`'s
  // own `onDragEnd` runs before the dispatch that announces, so `handleResize`
  // can record the outcome here and the announcer can read it — a drag released
  // back at its origin has to say "no change" rather than claim a write the
  // sub-slot guard rejected.
  const resizeAppliedRef = useRef(false);

  // dnd-kit's default announcements read raw draggable and droppable ids, so a
  // screen reader heard two UUIDs and a cell key ("dv-cell:<roomId>:555") where
  // the visible toast said "'MTP07 placement probe' moved". Name the session,
  // the room and the time instead.
  const announcements = useMemo<Announcements>(() => {
    const dataOf = (active: Active): DragData | undefined => active.data.current as DragData | undefined;
    const titleOf = (active: Active): string => dataOf(active)?.session.title ?? "This session";
    const slotOf = (over: Over | null): string | null => {
      const cell = over ? parseCellId(String(over.id)) : null;
      if (!cell) return null;
      return `${lookup.room(cell.roomId) ?? "no room"}, ${slotTimeLabel(cell.startMinutes)}`;
    };
    const edgeOf = (active: Active): "start" | "end" | null => {
      const type = dataOf(active)?.type;
      return type === "resize-start" ? "start" : type === "resize-end" ? "end" : null;
    };
    return {
      onDragStart: ({ active }) => {
        const edge = edgeOf(active);
        return edge
          ? `Adjusting the ${edge} time of ${titleOf(active)}.`
          : `Picked up ${titleOf(active)}.`;
      },
      onDragOver: ({ active, over }) => {
        const slot = slotOf(over);
        return slot ? `${titleOf(active)} is over ${slot}.` : undefined;
      },
      onDragEnd: ({ active, over }) => {
        const edge = edgeOf(active);
        if (edge) {
          return resizeAppliedRef.current
            ? `Updated the ${edge} time of ${titleOf(active)}.`
            : `No change to the ${edge} time of ${titleOf(active)}.`;
        }
        const slot = slotOf(over);
        return slot ? `Moved ${titleOf(active)} to ${slot}.` : `${titleOf(active)} stayed where it was.`;
      },
      onDragCancel: ({ active }) => `Cancelled. ${titleOf(active)} stayed where it was.`,
    };
  }, [lookup]);

  const formatDurationMinutes = (formatId: string | null): number => {
    if (formatId === null) return DEFAULT_FORMAT_DURATION_MINUTES;
    const format = formats.find((candidate) => String(candidate.id) === String(formatId));
    return format?.defaultDurationMins ?? DEFAULT_FORMAT_DURATION_MINUTES;
  };

  const handleMove = (data: Extract<DragData, { type: "session" | "unscheduled" }>, overId: string) => {
    if (!selectedDay) return;
    const cell = parseCellId(overId);
    if (!cell) return;

    // Wall-clock, not elapsed UTC: the two differ by an hour across a DST
    // transition, and the value is about to be applied as a wall-clock offset
    // from the drop cell. The resize path has always read both edges this way.
    const durationMinutes = data.type === "session" && data.session.startsAt && data.session.endsAt
      ? wallClockDurationMinutes(data.session.startsAt, data.session.endsAt, selectedDay, event.timezone)
      : formatDurationMinutes(data.session.formatId);

    // `cell.startMinutes + durationMinutes` can land past midnight — a 60-minute
    // session dropped in a 23:45 slot. `localWallTimeAt` rolls that onto the next
    // day rather than wrapping back to 00:45 of this one.
    const startLocal = localWallTimeAt(selectedDay, cell.startMinutes);
    const endLocal = localWallTimeAt(selectedDay, cell.startMinutes + durationMinutes);
    if (rejectSkippedWallTime(startLocal, endLocal)) return;
    const newStartsAt = zonedInputToUtc(startLocal, event.timezone).toISOString();
    const newEndsAt = zonedInputToUtc(endLocal, event.timezone).toISOString();

    move.mutate({
      id: data.session.id,
      version: data.session.rowVersion,
      startsAt: newStartsAt,
      endsAt: newEndsAt,
      roomId: cell.roomId as RoomId | null,
    });
  };

  const handleResize = (edge: "resize-start" | "resize-end", session: ScheduledSessionDTO, deltaPx: number) => {
    // Every path that returns early leaves this false, so the drag-end
    // announcement above describes what happened rather than what was asked for.
    resizeAppliedRef.current = false;
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
    // The clamp can bottom out at the minimum duration and hand back the same
    // edges; announcing that as "Updated" would misreport a write that never
    // happened — and writing it would bump row_version for nothing.
    if (next.startMinutes === startMinutes && next.endMinutes === endMinutes) return;
    resizeAppliedRef.current = true;

    const startLocal = localWallTimeAt(selectedDay, next.startMinutes);
    const endLocal = localWallTimeAt(selectedDay, next.endMinutes);
    if (rejectSkippedWallTime(startLocal, endLocal)) return;

    move.mutate({
      id: session.id,
      version: session.rowVersion,
      startsAt: zonedInputToUtc(startLocal, event.timezone).toISOString(),
      endsAt: zonedInputToUtc(endLocal, event.timezone).toISOString(),
      roomId: session.roomId,
    });
  };

  const handleDragEnd = (dragEnd: DragEndEvent) => {
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
          <AgendaDayDndContext
            eventId={eventId}
            selectedDay={selectedDay}
            sensors={sensors}
            onDragEnd={handleDragEnd}
            accessibility={{
              announcements,
              screenReaderInstructions: {
                draggable: "Sessions are moved by dragging with a pointer. To reschedule without one, open a session and set its room and time.",
              },
            }}
          >
            <div className="dv-layout">
              <div className="dv-side-panels">
                <UnscheduledPanel
                  sessions={dayUnscheduled}
                  lookup={lookup}
                  canPlace={rooms.length > 0}
                  onAutoPlace={() => setAutoPlaceOpen(true)}
                  {...(unscheduledTotal !== undefined ? { totalCount: unscheduledTotal } : {})}
                  {...(onEdit ? { onEdit } : {})}
                />
                <NeedsRoomPanel sessions={needsRoom} lookup={lookup} timezone={event.timezone} canPlace={rooms.length > 0} {...(onEdit ? { onEdit } : {})} />
              </div>
              {rooms.length === 0
                ? (
                  <div className="dv-no-rooms">
                    <EmptyState
                      icon={<MapPin size={26} />}
                      title="Add a room to build the day grid"
                      description="Timed sessions stay in Needs a room until there is a room column to place them in."
                      action={<a className="button button-primary" href={`/events/${eventId}/settings?tab=rooms`}>Open room settings</a>}
                    />
                  </div>
                )
                : (
                  <div className="dv-scroll">
                    <DayGrid
                      sessions={dayScheduled}
                      rooms={rooms}
                      range={range}
                      day={selectedDay}
                      lookup={lookup}
                      timezone={event.timezone}
                      {...(onEdit ? { onEdit } : {})}
                    />
                  </div>
                )}
            </div>
          </AgendaDayDndContext>
        )}
      <AutoPlaceDialog
        eventId={eventId}
        timezone={event.timezone}
        open={autoPlaceOpen}
        onClose={() => {
          setAutoPlaceOpen(false);
          void queryClient.invalidateQueries({ queryKey: agendaKeys.allSessions(eventId) });
        }}
      />
    </div>
  );
}
