/**
 * The Schedule Itinerary surface's anonymous, no-account "My schedule" —
 * per the M53 guardrail: "localStorage itinerary data stores stable session
 * ids only and reconciles removed/unpublished ids." Kept in its own module,
 * with the reconciliation/toggle logic as plain functions with no `window`
 * dependency, so the rule that actually matters (a stale starred id from a
 * session that was later unpublished or deleted must not linger, silently
 * corrupt an export, or crash the page) is unit-testable without a DOM.
 */

const KEY_PREFIX = "openboard:itinerary:";

function itineraryStorageKey(eventSlug: string): string {
  return `${KEY_PREFIX}${eventSlug}`;
}

/** `[]` on the server, on a disabled/unavailable store, or on corrupt JSON — never throws. */
export function readStarredIds(eventSlug: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(itineraryStorageKey(eventSlug));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

/** A no-op, not a throw, when storage is unavailable (private browsing quota, etc). */
export function writeStarredIds(eventSlug: string, ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(itineraryStorageKey(eventSlug), JSON.stringify(ids));
  } catch {
    // Silently stop persisting rather than breaking the page over a full/blocked store.
  }
}

/**
 * Drops any stored id that is no longer in the currently published set, and
 * de-duplicates. Order-preserving over `stored` so a visitor's star order
 * (oldest-starred-first) survives a reconciliation pass.
 */
export function reconcileStarredIds(stored: string[], publishedIds: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of stored) {
    if (publishedIds.has(id) && !seen.has(id)) {
      seen.add(id);
      kept.push(id);
    }
  }
  return kept;
}

export function toggleStarredId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];
}
