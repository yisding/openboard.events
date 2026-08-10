/**
 * How an event's name is shortened for chrome that has no room for it.
 *
 * These live apart from the components that use them because they are the
 * substitute for the browser demo fixture's hand-written `shortName` and logo
 * text: a real event row has only `name`, and both the admin shell and the
 * events hub card have to derive the same short forms from it.
 */

/**
 * The compact label the admin switcher and breadcrumb use. Real event names
 * carry a qualifier after a dash or a colon ("AI.Engineer Sandbox — NYC"); the
 * chrome only has room for the part before it.
 */
export function shortEventName(name: string): string {
  const head = name.split(/\s+[—–-]\s+|:\s+/u)[0]?.trim() || name.trim();
  return head.length > 28 ? `${head.slice(0, 27).trimEnd()}…` : head;
}

/**
 * A monogram from the event's own name: one letter per word, or the first
 * letters of a single word. `max` is how many letters the mark has room for.
 */
export function eventInitials(name: string, max = 2): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const letters = words.length > 1
    ? words.slice(0, max).map((word) => word.slice(0, 1)).join("")
    : (words[0] ?? "").slice(0, max);
  return (letters || "EV").toUpperCase();
}
