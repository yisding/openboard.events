/**
 * The one element this product promotes into the top layer by hand: the toast
 * stack (`toast.tsx` shows it as a `popover="manual"` so it paints above the
 * `<dialog>` drawers, which are in the top layer themselves).
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
 */

let stack: HTMLElement | null = null;

/** Called by the toast provider as its stack element mounts and unmounts. */
export function registerTopLayerStack(element: HTMLElement | null): void {
  stack = element;
}

/** Re-insert the stack at the end of the top layer. A no-op with no toasts up. */
export function raiseTopLayerStack(): void {
  if (!stack || typeof stack.showPopover !== "function") return;
  stack.setAttribute("popover", "manual");
  try {
    if (stack.matches(":popover-open")) stack.hidePopover();
    stack.showPopover();
  } catch {
    // A browser without popover support, or a failed show: leave an ordinary,
    // visible element behind rather than one the UA hides as a closed popover.
    stack.removeAttribute("popover");
  }
}
