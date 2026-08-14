"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Wand2 } from "lucide-react";
import type { ScheduledSessionDTO } from "@/shared/contracts";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Button } from "@/shared/ui/ui-kit";
import type { NameLookup } from "../../store";

/**
 * The Day view's own drag source for its Unscheduled and Needs a room trays.
 * It is deliberately separate from `unscheduled-tray.tsx`, which lives outside
 * this view's DndContext. An explicit Edit action also keeps every tray row
 * usable without requiring a precise pointer drag.
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
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(session.id),
    data: { type, session },
  });
  const track = lookup.track(session.trackId);
  const speakers = lookup.speakers(session.speakerIds);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: transform ? CSS.Translate.toString(transform) : undefined, touchAction: "none" }}
      className={isDragging ? "dv-unscheduled-card dv-unscheduled-card--dragging" : "dv-unscheduled-card"}
    >
      <div className="dv-tray-drag" {...attributes} {...listeners}>
        <GripVertical size={13} aria-hidden />
        <div>
          <b>{session.title}</b>
          <span>
            {timezone && session.startsAt
              ? <><TzTime instant={session.startsAt} tz={timezone} style={{ hour: "numeric", minute: "2-digit" }} /> · </>
              : null}
            {track?.name ?? "No track"}{speakers.length > 0 ? ` · ${speakers.join(", ")}` : ""}
          </span>
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

export function UnscheduledPanel({
  sessions,
  lookup,
  canPlace,
  onAutoPlace,
  onEdit,
}: {
  sessions: ScheduledSessionDTO[];
  lookup: NameLookup;
  canPlace: boolean;
  onAutoPlace: () => void;
  onEdit?: (id: string) => void;
}) {
  return (
    <aside className="dv-unscheduled-panel">
      <header>
        <div>
          <h3>Unscheduled</h3>
          <span>{sessions.length}</span>
        </div>
        <Button variant="secondary" size="sm" disabled={sessions.length === 0} onClick={onAutoPlace}>
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
    <aside className="dv-unscheduled-panel dv-needs-room-panel">
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
