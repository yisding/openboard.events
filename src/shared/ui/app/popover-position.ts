import type { CSSProperties } from "react";

/**
 * Fixed-position geometry for anything that floats beside an anchor: the
 * ambient first-run hint card and the guided tour's coach card both open a
 * portalled, `position: fixed` panel next to an element they do not own.
 *
 * It lives on its own so the two consumers cannot drift apart, and it stays a
 * pure function so the clamping is testable without a browser. What the two
 * callers do *after* a scroll differs on purpose and is not this module's
 * business: `first-run-hints` closes (an ambient beacon that follows the page
 * would be nagging), while the tour re-measures (a tutorial that dismissed
 * itself the moment it scrolled its own target into view would be broken).
 */

export type PopoverPlacement = "right" | "bottom" | "bottom-end" | "top" | "left";

export type PopoverAnchorRect = { top: number; right: number; bottom: number; left: number };

export type PopoverViewport = { width: number; height: number };

/**
 * Overrides for a panel that is not hint-sized. `clearance` is a conservative
 * estimate of the tallest the panel gets: the card is measured after it opens,
 * so the only honest way to keep it inside the bottom edge beforehand is to
 * reserve room for the worst case.
 */
export type PopoverBox = { width?: number; clearance?: number };

export const POPOVER_WIDTH = 264;
export const POPOVER_CLEARANCE = 190;
export const POPOVER_EDGE_MARGIN = 12;

/** Gap between the anchor's edge and the panel. */
const OFFSET = 10;

export function popoverPosition(
  placement: PopoverPlacement,
  anchor: PopoverAnchorRect,
  viewport: PopoverViewport,
  box: PopoverBox = {},
): CSSProperties {
  const width = box.width ?? POPOVER_WIDTH;
  const clearance = box.clearance ?? POPOVER_CLEARANCE;
  const margin = POPOVER_EDGE_MARGIN;
  const clampLeft = (left: number) => Math.min(Math.max(margin, left), Math.max(margin, viewport.width - width - margin));
  const clampTop = (top: number) => Math.min(Math.max(margin, top), Math.max(margin, viewport.height - clearance));
  if (placement === "right") return { left: clampLeft(anchor.right + OFFSET), top: clampTop(anchor.top - 8) };
  if (placement === "left") return { left: clampLeft(anchor.left - width - OFFSET), top: clampTop(anchor.top - 8) };
  // Top opens *above* the anchor, so the reserved clearance is what positions
  // it: the panel's own height is unknown until it has rendered.
  if (placement === "top") return { left: clampLeft(anchor.left), top: clampTop(anchor.top - clearance - OFFSET) };
  if (placement === "bottom-end") return { left: clampLeft(anchor.right - width), top: clampTop(anchor.bottom + OFFSET) };
  return { left: clampLeft(anchor.left), top: clampTop(anchor.bottom + OFFSET) };
}
