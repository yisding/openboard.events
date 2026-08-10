"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, type CSSProperties } from "react";
import type { ScheduledSessionDTO, TrackDTO } from "@/shared/contracts";
import { cn } from "@/shared/lib/cn";
import { TzTime } from "@/shared/ui/app/tz-time";
import { useDayGridConflicts } from "../../hooks/use-day-grid-state";
import { ResizeHandles } from "./resize-handles";

function initialsOf(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

/**
 * A positioned, draggable session block. `gridRow`/`gridColumn` place it on
 * the same CSS grid the droppable cells occupy (`day-grid.tsx`) — dragging
 * moves the whole session, the two `ResizeHandles` strips on its edges adjust
 * one boundary each.
 *
 * The conflict outline reads M29's server-authoritative result via the
 * day-view-local store, recomputed by `day-view.tsx` on every session-list
 * change (including the optimistic patch, before any server round trip) — this
 * component never runs `detectConflicts` itself.
 */
export function SessionCard({
  session,
  roomIndex,
  startRow,
  endRow,
  track,
  speakerNames,
  timezone,
  onEdit,
}: {
  session: ScheduledSessionDTO;
  roomIndex: number;
  startRow: number;
  endRow: number;
  track: TrackDTO | null;
  speakerNames: string[];
  timezone: string;
  onEdit?: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(session.id),
    data: { type: "session", session },
  });

  const conflicts = useDayGridConflicts();
  const severity = useMemo(() => {
    const hits = conflicts.filter((conflict) => conflict.a === session.id || conflict.b === session.id);
    if (hits.length === 0) return null;
    return hits.some((conflict) => conflict.severity === "error") ? "error" : "warning";
  }, [conflicts, session.id]);

  // Mirrors `<ColorChip>`'s alpha-suffix pattern: the track's own hex colour,
  // never a feature-local palette, so this card looks identical to the same
  // track's chip in the List view and the public schedule.
  const trackStyle: CSSProperties = track?.color
    ? { borderColor: `${track.color}55`, borderLeftColor: track.color, background: `${track.color}1f`, color: track.color }
    : {};

  const style: CSSProperties = {
    gridRow: `${startRow} / ${endRow}`,
    // +1 for 1-based grid lines, +1 again for the time-label column at index 1.
    gridColumn: roomIndex + 2,
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    touchAction: "none",
    ...trackStyle,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "dv-session-card",
        severity && `dv-session-card--${severity}`,
        isDragging && "dv-session-card--dragging",
      )}
      aria-label={`${session.title}, drag to reschedule`}
      onDoubleClick={() => onEdit?.(String(session.id))}
      {...attributes}
      {...listeners}
    >
      <ResizeHandles session={session} />
      <b>{session.title}</b>
      <span className="dv-session-card-time">
        <TzTime instant={session.startsAt} tz={timezone} style={{ hour: "numeric", minute: "2-digit" }} />
        {" – "}
        <TzTime instant={session.endsAt} tz={timezone} style={{ hour: "numeric", minute: "2-digit" }} />
      </span>
      {speakerNames.length > 0 && (
        <span className="dv-session-card-speakers">{speakerNames.map(initialsOf).join(" ")}</span>
      )}
    </div>
  );
}
