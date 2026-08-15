import type { KeyboardEvent } from "react";

/**
 * The keyboard half of the ARIA tabs pattern, shared by every `role="tablist"`
 * in the app.
 *
 * A tab strip is one tab stop, not one per tab: the selected tab carries
 * `tabIndex={0}` and the rest `-1`, and the arrows move between them. Declaring
 * the roles without this is worse than declaring nothing — a screen reader
 * announces "tab 2 of 7, use arrow keys" and the arrows then do nothing.
 *
 * Focus follows selection, which is what makes the roving tabIndex coherent:
 * the tab that becomes selected is the one that becomes the strip's tab stop,
 * so focus has to travel with it or the next Tab press leaves from the wrong
 * place. The destination is read from the DOM rather than by id, so a strip
 * needs no extra markup to opt in.
 *
 * Focus only travels when the selection is actually taken. A strip whose
 * selection can be refused — the comms tabs defer to the unsaved-work guard —
 * returns `false` from `select`, and focus stays on the tab that is still the
 * strip's tab stop rather than landing on one that carries `tabIndex={-1}`.
 */
export function moveRovingTab<T extends string>(
  event: KeyboardEvent<HTMLElement>,
  ids: readonly T[],
  current: T,
  select: (next: T) => boolean | void,
): void {
  const currentIndex = ids.indexOf(current);
  if (currentIndex < 0) return;
  const nextIndex = event.key === "ArrowRight"
    ? (currentIndex + 1) % ids.length
    : event.key === "ArrowLeft"
      ? (currentIndex - 1 + ids.length) % ids.length
      : event.key === "Home"
        ? 0
        : event.key === "End"
          ? ids.length - 1
          : null;
  if (nextIndex === null) return;
  const next = ids[nextIndex];
  if (next === undefined) return;
  event.preventDefault();
  const destination = event.currentTarget.closest('[role="tablist"]')
    ?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex];
  if (select(next) === false) return;
  destination?.focus();
}
