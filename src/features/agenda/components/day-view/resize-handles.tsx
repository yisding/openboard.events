"use client";

import { useDraggable } from "@dnd-kit/core";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ScheduledSessionDTO } from "@/shared/contracts";

type Listeners = ReturnType<typeof useDraggable>["listeners"];

/**
 * Stops the native pointerdown from bubbling to the session card's own
 * `useDraggable` listeners before invoking the handle's — otherwise a touch on
 * the resize strip would start both a card-move drag and a resize drag at
 * once, since both listener sets are plain `onPointerDown` handlers on nested
 * elements.
 */
function isolate(listeners: Listeners): Listeners {
  return {
    ...listeners,
    onPointerDown: (event: ReactPointerEvent) => {
      event.stopPropagation();
      listeners?.onPointerDown?.(event);
    },
  } as Listeners;
}

/**
 * Two thin drag strips on a session card's top and bottom edges. Top adjusts
 * `startsAt` only, bottom adjusts `endsAt` only — `day-view.tsx`'s
 * `onDragEnd` reads `event.delta.y` (the total pointer displacement, not a
 * drop-cell lookup) for these, converts it to a slot count via
 * `pixelDeltaToSlotDelta`, and clamps with `clampResize`.
 *
 * The strips are pointer-only affordances, so `attributes: { tabIndex: -1 }`
 * overrides dnd-kit's focusable default: they are `aria-hidden`, and a
 * focusable element that assistive tech cannot describe is a silent dead tab
 * stop (two per placed session). Keyboard organizers adjust times in the
 * session dialog instead.
 */
export function ResizeHandles({ session, disabled = false }: { session: ScheduledSessionDTO; disabled?: boolean }) {
  const start = useDraggable({ id: `resize:${session.id}:start`, data: { type: "resize-start", session }, disabled, attributes: { tabIndex: -1 } });
  const end = useDraggable({ id: `resize:${session.id}:end`, data: { type: "resize-end", session }, disabled, attributes: { tabIndex: -1 } });

  return (
    <>
      <span
        ref={start.setNodeRef}
        className="dv-resize-handle dv-resize-handle--top"
        style={{ touchAction: "none" }}
        aria-hidden
        {...start.attributes}
        {...isolate(start.listeners)}
      />
      <span
        ref={end.setNodeRef}
        className="dv-resize-handle dv-resize-handle--bottom"
        style={{ touchAction: "none" }}
        aria-hidden
        {...end.attributes}
        {...isolate(end.listeners)}
      />
    </>
  );
}
