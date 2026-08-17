"use client";

import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Kept in step with the DndContext's `activationConstraint: { distance: 8 }`
 * (`day-view.tsx`): a press that never travels this far cannot have started a
 * drag, so the `click` that follows it is a plain click on the session.
 */
export const CLICK_SLOP_PX = 8;

export type PressPoint = { x: number; y: number };

/**
 * Did this press/release pair end as a click on the session, or as the tail of
 * a drag? The browser still fires `click` on a drag source when the pointer
 * comes back to rest over it, and dnd-kit does not swallow that for us — so a
 * drag source that also opens on click has to answer the question itself.
 *
 * Two answers mean "drag": dnd-kit reported a drag (`dragged`), or the pointer
 * travelled past the sensor's activation distance — which covers a drag that
 * ended over another element, and a press that was released outside any drop
 * cell. A press with no recorded origin is not ours either: that is how a
 * gesture which began on a resize handle reaches the card.
 */
export function isClickNotDrag(origin: PressPoint | null, release: PressPoint, dragged: boolean): boolean {
  if (dragged || origin === null) return false;
  return Math.hypot(release.x - origin.x, release.y - origin.y) <= CLICK_SLOP_PX;
}

/**
 * Wires the guard above onto a dnd-kit drag source. Spread the handlers *after*
 * `{...listeners}` and chain `onPointerDown` into dnd-kit's own, so the drag
 * keeps working and the click stays a click:
 *
 * ```tsx
 * {...listeners}
 * onPointerDownCapture={openOnClick.onPointerDownCapture}
 * onPointerDown={(event) => { openOnClick.onPointerDown(event); listeners?.onPointerDown?.(event); }}
 * onClick={openOnClick.onClick}
 * ```
 *
 * The capture handler is what keeps nested drag sources honest: `ResizeHandles`
 * stops the native pointerdown from bubbling, so the bubble-phase handler never
 * records an origin for a resize gesture — but the capture phase runs first for
 * every press inside the card and clears whatever the previous gesture left, so
 * a resize can never release into a stale origin and open the editor.
 */
export function useOpenOnClick(isDragging: boolean, onOpen: () => void) {
  const origin = useRef<PressPoint | null>(null);
  const dragged = useRef(false);

  // dnd-kit reports a started drag through a render, long before the pointer is
  // released, so this ref is settled by the time `click` arrives.
  useEffect(() => {
    if (isDragging) dragged.current = true;
  }, [isDragging]);

  return {
    onPointerDownCapture: () => {
      origin.current = null;
      dragged.current = false;
    },
    onPointerDown: (event: ReactPointerEvent) => {
      origin.current = { x: event.clientX, y: event.clientY };
    },
    onClick: (event: ReactMouseEvent) => {
      const wasClick = isClickNotDrag(origin.current, { x: event.clientX, y: event.clientY }, dragged.current);
      origin.current = null;
      if (wasClick) onOpen();
    },
  };
}
