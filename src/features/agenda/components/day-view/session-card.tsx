"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import type { ScheduledSessionDTO, TrackDTO } from "@/shared/contracts";
import { cn } from "@/shared/lib/cn";
import { TzTime } from "@/shared/ui/app/tz-time";
import { useDayGridConflicts } from "../../hooks/use-day-grid-state";
import { ResizeHandles } from "./resize-handles";

function initialsOf(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

export function isCompactSession(durationMinutes: number): boolean {
  return durationMinutes <= 45;
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
  durationMinutes,
  lane,
  track,
  speakerNames,
  timezone,
  onEdit,
}: {
  session: ScheduledSessionDTO;
  roomIndex: number;
  startRow: number;
  endRow: number;
  durationMinutes: number;
  lane: { index: number; count: number };
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
  const compact = isCompactSession(durationMinutes);

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
    left: lane.count > 1 ? `${(lane.index * 100) / lane.count}%` : undefined,
    width: lane.count > 1 ? `calc(${100 / lane.count}% - 8px)` : undefined,
    justifySelf: lane.count > 1 ? "start" : undefined,
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    touchAction: "none",
    ...trackStyle,
    ...(severity === "error"
      ? { borderTopColor: "var(--red)", borderRightColor: "var(--red)", borderBottomColor: "var(--red)" }
      : severity === "warning"
        ? { borderTopColor: "var(--amber)", borderRightColor: "var(--amber)", borderBottomColor: "var(--amber)" }
        : {}),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "dv-session-card",
        severity && `dv-session-card--${severity}`,
        compact && "dv-session-card--compact",
        durationMinutes < 30 && "dv-session-card--single-line",
        isDragging && "dv-session-card--dragging",
      )}
      aria-label={`${session.title}${severity ? ", has a scheduling conflict" : ""}, drag to reschedule`}
      title={speakerNames.length > 0 ? `${session.title} · ${speakerNames.join(", ")}` : session.title}
      onDoubleClick={() => onEdit?.(String(session.id))}
      {...attributes}
      {...listeners}
    >
      <ResizeHandles session={session} />
      {severity && <AlertTriangle className="dv-session-card-conflict-icon" size={13} aria-hidden="true" />}
      {compact ? <div className="dv-session-card-compact-line">
        <span className="dv-session-card-time"><TzTime instant={session.startsAt} tz={timezone} style={{ hour: "numeric", minute: "2-digit" }} zoneDisplay="context" /></span>
        <b>{session.title}</b>
      </div> : <>
        <b>{session.title}</b>
        <span className="dv-session-card-time">
          <TzTime instant={session.startsAt} tz={timezone} style={{ hour: "numeric", minute: "2-digit" }} zoneDisplay="context" />
          {" – "}
          <TzTime instant={session.endsAt} tz={timezone} style={{ hour: "numeric", minute: "2-digit" }} zoneDisplay="context" />
        </span>
      </>}
      {!compact && speakerNames.length > 0 && (
        <span className="dv-session-card-speakers">{speakerNames.map(initialsOf).join(" ")}</span>
      )}
    </div>
  );
}
