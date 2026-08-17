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
  /*
   * Which sides the panel actually fits on.
   *
   * Every placement below is a preference, not an instruction. Clamping a
   * panel that does not fit puts it *on top of the control it points at* —
   * the anchor is exactly the thing the player has to click next, and a
   * tutorial that covers its own target is worse than one that opens on the
   * other side. So each placement names the side it wants, and falls back to
   * the opposite one when its own has no room.
   */
  const roomAbove = anchor.top - OFFSET - margin >= clearance;
  const roomBelow = viewport.height - anchor.bottom - OFFSET >= clearance;
  const roomRight = viewport.width - anchor.right - OFFSET - width >= margin;
  const roomLeft = anchor.left - OFFSET - width >= margin;
  /*
   * Above pins the panel's **bottom** edge instead of guessing its top: its
   * own height is unknown until it has rendered, `clearance` is only an
   * estimate, and a panel taller than the estimate positioned by `top` lands
   * right on the control it is pointing at — the tour's coach card grew a hint
   * and a side-quest tray and then covered the Add question button it was
   * spotlighting. Anchoring the far edge is exact for any height.
   */
  const above = (left: number) => ({ left: clampLeft(left), bottom: viewport.height - anchor.top + OFFSET });
  const below = (left: number) => ({ left: clampLeft(left), top: clampTop(anchor.bottom + OFFSET) });
  const rightOf = (top: number) => ({ left: clampLeft(anchor.right + OFFSET), top: clampTop(top) });
  const leftOf = (top: number) => ({ left: clampLeft(anchor.left - width - OFFSET), top: clampTop(top) });
  if (placement === "right") return roomRight || !roomLeft ? rightOf(anchor.top - 8) : leftOf(anchor.top - 8);
  if (placement === "left") return roomLeft || !roomRight ? leftOf(anchor.top - 8) : rightOf(anchor.top - 8);
  if (placement === "top") return roomAbove ? above(anchor.left) : below(anchor.left);
  const left = placement === "bottom-end" ? anchor.right - width : anchor.left;
  return roomBelow || !roomAbove ? below(left) : above(left);
}
