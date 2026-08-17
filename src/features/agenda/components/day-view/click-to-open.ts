"use client";

import { useDndContext } from "@dnd-kit/core";
import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Kept in step with the DndContext's `activationConstraint: { distance: 8 }`
 * (`day-view.tsx`): a press that never travels this far cannot have started a
 * drag — of the card, or of one of its resize strips — so the `click` that
 * follows it is a plain click on the session.
 */
export const CLICK_SLOP_PX = 8;

export type PressPoint = { x: number; y: number };

/**
 * Did this press/release pair end as a click on the session, or as the tail of
 * a drag? A drag source that also opens on click has to answer that itself.
 *
 * Two answers mean "drag": the DndContext reported one while the pointer was
 * down (`dragged`), or the pointer travelled past the sensor's activation
 * distance — which covers a drag that ended over another element, and a press
 * released outside any drop cell. A release with no recorded press is not ours
 * either: every pointer press inside the drag source records one, so a `click`
 * arriving without one was synthesized rather than pressed.
 */
export function isClickNotDrag(origin: PressPoint | null, release: PressPoint, dragged: boolean): boolean {
  if (dragged || origin === null) return false;
  return Math.hypot(release.x - origin.x, release.y - origin.y) <= CLICK_SLOP_PX;
}

/**
 * Wires the guard above onto a dnd-kit drag source. Spread the handlers *after*
 * `{...listeners}`, which they do not overlap, so the drag keeps working and
 * the click stays a click:
 *
 * ```tsx
 * {...listeners}
 * onPointerDownCapture={openOnClick.onPointerDownCapture}
 * onClick={openOnClick.onClick}
 * ```
 *
 * The press is recorded in the *capture* phase on purpose. `ResizeHandles`
 * stops the native pointerdown from bubbling, so a bubble-phase handler would
 * never see a press that landed on a resize strip — and on a 15-minute session
 * the two 6px strips cover all but ~2px of a 14px-tall card, which would leave
 * the shortest blocks with no clickable middle at all. Capture runs before the
 * strip can stop anything, and a press that ends up *resizing* is caught by the
 * two checks above instead: dnd-kit reports the resize through `active`, and
 * the pointer has by definition travelled past the activation distance.
 */
export function useOpenOnClick(isDragging: boolean, onOpen: () => void) {
  // `active` covers the resize strips too — their `useDraggable` is a sibling
  // of the card's, so the card's own `isDragging` stays false through a resize.
  const { active } = useDndContext();
  const origin = useRef<PressPoint | null>(null);
  const dragged = useRef(false);

  // dnd-kit reports a started drag through a render, long before the pointer is
  // released, so this ref is settled by the time `click` arrives.
  useEffect(() => {
    if (isDragging || active !== null) dragged.current = true;
  }, [isDragging, active]);

  return {
    onPointerDownCapture: (event: ReactPointerEvent) => {
      origin.current = { x: event.clientX, y: event.clientY };
      dragged.current = false;
    },
    onClick: (event: ReactMouseEvent) => {
      const wasClick = isClickNotDrag(origin.current, { x: event.clientX, y: event.clientY }, dragged.current);
      origin.current = null;
      if (wasClick) onOpen();
    },
  };
}
