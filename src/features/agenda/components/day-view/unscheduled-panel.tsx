"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Wand2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ScheduledSessionDTO } from "@/shared/contracts";
import { emojiRain } from "@/shared/ui/emoji-rain";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button } from "@/shared/ui/ui-kit";
import type { NameLookup } from "../../store";
import { AbstractDivergenceChip } from "../abstract-divergence-chip";
import { useOpenOnClick } from "./click-to-open";

/**
 * The Day view's own drag source for its Unscheduled and Needs a room trays.
 * It is deliberately separate from `unscheduled-tray.tsx`, which lives outside
 * this view's DndContext. Like that tray's rows, the whole row opens the
 * session on click; the explicit Edit action stays as the keyboard route, so
 * no row depends on a precise pointer drag.
 */
function TrayCard({
  session,
  lookup,
  type,
  timezone,
  onEdit,
}: {
  session: ScheduledSessionDTO;
  lookup: NameLookup;
  type: "session" | "unscheduled";
  timezone?: string;
  onEdit?: (id: string) => void;
}) {
  // `attributes` is deliberately not spread onto the drag region: dnd-kit would
  // make it a focusable role="button" that announces "press the space bar to
  // pick up a draggable item", and this view registers a PointerSensor only.
  // The Edit button below stays the row's keyboard and assistive-tech route —
  // the row's own click below is a pointer affordance on top of it, not a
  // replacement, so the row never becomes a second silent tab stop.
  const { listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(session.id),
    data: { type, session },
  });
  // Clicking the row opens the session, which is what the panel's own hint
  // ("open a session to place it precisely") and the workspace tray
  // (`unscheduled-tray.tsx`, whose rows are plain buttons) already promise. The
  // guard tells that click apart from the end of a drag onto the grid.
  const openOnClick = useOpenOnClick(isDragging, () => onEdit?.(String(session.id)));
  const track = lookup.track(session.trackId);
  const speakers = lookup.speakers(session.speakerIds);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: transform ? CSS.Translate.toString(transform) : undefined, touchAction: "none" }}
      className={isDragging ? "dv-unscheduled-card dv-unscheduled-card--dragging" : "dv-unscheduled-card"}
    >
      <div
        className="dv-tray-drag"
        title={onEdit ? "Click to edit · drag onto the grid" : undefined}
        {...listeners}
        onPointerDownCapture={openOnClick.onPointerDownCapture}
        onPointerDown={(pointerEvent) => {
          openOnClick.onPointerDown(pointerEvent);
          listeners?.onPointerDown?.(pointerEvent);
        }}
        onClick={openOnClick.onClick}
      >
        <GripVertical size={13} aria-hidden />
        <div>
          <b>{session.title}</b>
          <span>
            {timezone && session.startsAt
              ? <><TzTime instant={session.startsAt} tz={timezone} style={{ hour: "numeric", minute: "2-digit" }} /> · </>
              : null}
            {track?.name ?? "No track"}{speakers.length > 0 ? ` · ${speakers.join(", ")}` : ""}
          </span>
          <AbstractDivergenceChip session={session} />
        </div>
      </div>
      {onEdit && (
        <button
          type="button"
          className="dv-tray-edit"
          onClick={() => onEdit(String(session.id))}
        >Edit</button>
      )}
    </div>
  );
}

/**
 * Placing the very last unscheduled session is the agenda's finish line — a
 * moment worth a small celebration, but only when the organizer actually
 * crossed it. Arriving at an already-empty tray (page load, view switch)
 * celebrates nothing. Exported pure so the guard is testable.
 */
export function boardJustCleared(previousCount: number, currentCount: number): boolean {
  return previousCount > 0 && currentCount === 0;
}

export function UnscheduledPanel({
  sessions,
  totalCount,
  lookup,
  canPlace,
  onAutoPlace,
  onEdit,
}: {
  sessions: ScheduledSessionDTO[];
  /**
   * Unscheduled count over the event's *unfiltered* session list. `sessions`
   * arrives narrowed by the agenda's search box, so the celebration below
   * watches this instead — a search that hides the tray is not a cleared
   * board. Falls back to the displayed count when a caller has no filter.
   */
  totalCount?: number;
  lookup: NameLookup;
  canPlace: boolean;
  onAutoPlace: () => void;
  onEdit?: (id: string) => void;
}) {
  // Easter egg: the last session leaving the tray — by drag, edit, or
  // auto-place — earns a brief shower over the finished board. The same
  // self-cleaning overlay the app's other eggs use; a no-op under
  // prefers-reduced-motion.
  const celebrationCount = totalCount ?? sessions.length;
  const previousCount = useRef(celebrationCount);
  useEffect(() => {
    const previous = previousCount.current;
    previousCount.current = celebrationCount;
    if (boardJustCleared(previous, celebrationCount)) emojiRain(["🗓️", "🎉", "✨"], 18);
  }, [celebrationCount]);

  return (
    // Named, because the Day view puts two complementary landmarks side by
    // side and an unnamed one is announced as "complementary" and nothing
    // else. The names are also what lets the tour tell the two apart.
    <aside className="dv-unscheduled-panel" aria-label="Unscheduled sessions">
      <header>
        <div>
          <h3>Unscheduled</h3>
          <span>{sessions.length}</span>
        </div>
        {/* `data-tour`: "Auto-place" is also the label of the workspace tray's
            button in `unscheduled-tray.tsx`, and this is the one the Day view
            actually renders. */}
        <Button data-tour="agenda.auto-place-tray" variant="secondary" size="sm" disabled={sessions.length === 0} onClick={onAutoPlace}>
          <Wand2 size={14} aria-hidden /> Auto-place
        </Button>
      </header>
      {sessions.length === 0
        ? <p className="dash">Everything is placed.</p>
        : (
          <>
            <p className="dv-unscheduled-hint">{canPlace ? "Drag onto the grid, or open a session to place it precisely." : "Add a room, then open a session to place it."}</p>
            {sessions.map((session) => <TrayCard key={String(session.id)} session={session} lookup={lookup} type="unscheduled" {...(onEdit ? { onEdit } : {})} />)}
          </>
        )}
    </aside>
  );
}

export function NeedsRoomPanel({
  sessions,
  lookup,
  timezone,
  canPlace,
  onEdit,
}: {
  sessions: ScheduledSessionDTO[];
  lookup: NameLookup;
  timezone: string;
  canPlace: boolean;
  onEdit?: (id: string) => void;
}) {
  if (sessions.length === 0) return null;
  return (
    <aside className="dv-unscheduled-panel dv-needs-room-panel" aria-label="Sessions that need a room">
      <header>
        <h3>Needs a room</h3>
        <span>{sessions.length}</span>
      </header>
      <p className="dv-unscheduled-hint">{canPlace ? "Drag into a room to place." : "Add a room, then place these timed sessions."}</p>
      {sessions.map((session) => (
        <TrayCard key={String(session.id)} session={session} lookup={lookup} type="session" timezone={timezone} {...(onEdit ? { onEdit } : {})} />
      ))}
    </aside>
  );
}
