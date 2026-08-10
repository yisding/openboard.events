"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ScheduledSessionDTO } from "@/shared/contracts";
import type { NameLookup } from "../../store";

/**
 * The Day view's own drag source for "drag from tray to schedule" — deliberately
 * separate from `unscheduled-tray.tsx` (M28-owned, rendered alongside this view
 * by `agenda-page.tsx`, static/click-to-edit only). Duplicating the unscheduled
 * list here keeps the entire drag interaction inside the one `<DndContext>`
 * `day-view.tsx` owns end-to-end, with zero edits to a file M28 owns — the
 * trade-off is that an unscheduled session appears in both panels while the Day
 * view is open, which is intentional per the work order rather than an oversight.
 */
function UnscheduledCard({ session, lookup }: { session: ScheduledSessionDTO; lookup: NameLookup }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: String(session.id),
    data: { type: "unscheduled", session },
  });
  const track = lookup.track(session.trackId);
  const speakers = lookup.speakers(session.speakerIds);

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={{ transform: transform ? CSS.Translate.toString(transform) : undefined, touchAction: "none" }}
      className={isDragging ? "dv-unscheduled-card dv-unscheduled-card--dragging" : "dv-unscheduled-card"}
      {...attributes}
      {...listeners}
    >
      <GripVertical size={13} aria-hidden />
      <div>
        <b>{session.title}</b>
        <span>{track?.name ?? "No track"}{speakers.length > 0 ? ` · ${speakers.join(", ")}` : ""}</span>
      </div>
    </button>
  );
}

export function UnscheduledPanel({ sessions, lookup }: { sessions: ScheduledSessionDTO[]; lookup: NameLookup }) {
  return (
    <aside className="dv-unscheduled-panel">
      <header>
        <h3>Unscheduled</h3>
        <span>{sessions.length}</span>
      </header>
      {sessions.length === 0
        ? <p className="dash">Everything is placed.</p>
        : (
          <>
            <p className="dv-unscheduled-hint">Drag onto the grid to place.</p>
            {sessions.map((session) => <UnscheduledCard key={String(session.id)} session={session} lookup={lookup} />)}
          </>
        )}
    </aside>
  );
}
