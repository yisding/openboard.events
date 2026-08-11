/**
 * M60 — "Happening now / up next." Pure and cache-safe by construction: it
 * takes `now` as an argument rather than reading the clock itself, so the
 * public agenda (edge-cached, `revalidate = 60`) can compute this
 * client-side on a periodic timer and never bake a highlight into the
 * server-rendered HTML a CDN then serves stale for up to a minute
 * (experience-design.md's "Happening now / up next" bullet, verbatim: "never
 * baked into server-rendered markup").
 */
export type LiveHighlight = {
  /** Every session whose window currently contains `now` — usually zero or one, but concurrent rooms make more than one legitimate. */
  nowSessionIds: ReadonlySet<string>;
  /** The single soonest session that has not started yet, regardless of whether something else is live right now. */
  nextSessionId: string | null;
};

export const EMPTY_LIVE_HIGHLIGHT: LiveHighlight = { nowSessionIds: new Set(), nextSessionId: null };

export function computeLiveHighlight(
  sessions: ReadonlyArray<{ id: string; startsAt: string; endsAt: string }>,
  now: Date,
): LiveHighlight {
  const nowMs = now.getTime();
  const nowSessionIds = new Set<string>();
  let nextSessionId: string | null = null;
  let nextStartMs = Infinity;
  for (const session of sessions) {
    const startMs = new Date(session.startsAt).getTime();
    const endMs = new Date(session.endsAt).getTime();
    if (startMs <= nowMs && nowMs < endMs) {
      nowSessionIds.add(session.id);
    } else if (startMs > nowMs && startMs < nextStartMs) {
      nextStartMs = startMs;
      nextSessionId = session.id;
    }
  }
  return { nowSessionIds, nextSessionId };
}
