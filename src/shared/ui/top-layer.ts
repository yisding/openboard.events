/**
 * Promoting an element into the top layer by hand. Two callers: the toast stack
 * (`toast.tsx` shows it as a `popover="manual"` so it paints above the
 * `<dialog>` drawers, which are in the top layer themselves) and the guided
 * tour's confetti, which has the same problem for the same reason.
 *
 * This buys **paint order only**. An element raised over an open modal
 * `<dialog>` is painted above it and is still inert — no pointer events, no
 * focus — because a modal dialog's inertness exempts its own subtree and
 * nothing else. Fine for confetti and for toasts, which are read rather than
 * used; anything the player has to *press* while a modal is open has to be
 * rendered inside that dialog instead (see `useCardHost` in guided-tour/coach).
 *
 * Top-layer order is insertion order, and it settles more than paint order:
 * everything a modal `<dialog>` does not contain is blocked by it, so an
 * element sitting *below* the dialog is not merely hidden behind the backdrop —
 * it stops taking pointer events and drops out of the accessibility tree.
 * `toast.tsx` re-raises whenever the set of toasts changes, which covers a
 * toast raised from inside an open drawer. The reverse order was not covered:
 * errors never auto-dismiss, so an error toast is routinely still on screen
 * when the next drawer opens, and that drawer went in above it.
 *
 * This lives in its own module rather than in `toast.tsx` so `ui-kit.tsx` can
 * call it from `showModal()` without importing the toast module — which many
 * component tests replace wholesale with a `vi.mock` of `useToast`.
 *
 * Anything raised this way owes the UA's `[popover]` box an undo in CSS —
 * `inset: 0`, `margin: auto`, a border, a padding and an opaque background —
 * see `.toast-stack`, `.egg-rain` and `.tour-coach` in globals.css.
 */

let stack: HTMLElement | null = null;

/**
 * Leave the top layer if the element is in it. `hidePopover()` throws rather
 * than no-ops on an element that was not showing, and `:popover-open` is not a
 * selector every engine parses, so the throw is the cheapest test there is.
 */
function hideIfShown(element: HTMLElement): void {
  try {
    element.hidePopover();
  } catch {
    // Was not showing — nothing to leave.
  }
}

/**
 * Insert `element` at the end of the top layer — above whatever modal dialog is
 * open right now — as a manual popover, which neither traps focus nor closes on
 * Escape. Already raised is fine: it leaves and re-enters at the end.
 */
export function raiseIntoTopLayer(element: HTMLElement | null): void {
  if (!element || typeof element.showPopover !== "function") return;
  element.setAttribute("popover", "manual");
  try {
    hideIfShown(element);
    element.showPopover();
  } catch {
    // A browser without popover support, or a failed show: leave an ordinary,
    // visible element behind rather than one the UA hides as a closed popover.
    element.removeAttribute("popover");
  }
}

/** Put a raised element back in normal flow, at its own z-index. */
export function dropFromTopLayer(element: HTMLElement | null): void {
  if (!element?.hasAttribute("popover")) return;
  hideIfShown(element);
  element.removeAttribute("popover");
}

/** Called by the toast provider as its stack element mounts and unmounts. */
export function registerTopLayerStack(element: HTMLElement | null): void {
  stack = element;
}

/** Re-insert the stack at the end of the top layer. A no-op with no toasts up. */
export function raiseTopLayerStack(): void {
  raiseIntoTopLayer(stack);
}
