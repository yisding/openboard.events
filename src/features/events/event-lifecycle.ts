export type EventLifecycle = "current" | "upcoming" | "past";

type EventInterval = { id: string; startsAt: string; endsAt: string };

const MAX_BROWSER_TIMEOUT_MS = 2_147_483_647;

export function eventLifecycle(event: EventInterval, nowIso: string): EventLifecycle {
  const now = new Date(nowIso).getTime();
  const startsAt = new Date(event.startsAt).getTime();
  const endsAt = new Date(event.endsAt).getTime();
  // Event intervals are [start, end): the opening instant is already current,
  // while the exact closing instant belongs in history.
  if (startsAt <= now && endsAt > now) return "current";
  return startsAt > now ? "upcoming" : "past";
}

export function orderEventsByLifecycle<T extends EventInterval>(rows: readonly T[], nowIso: string): T[] {
  const rank: Record<EventLifecycle, number> = { current: 0, upcoming: 1, past: 2 };
  return [...rows].sort((left, right) => {
    const leftLifecycle = eventLifecycle(left, nowIso);
    const rightLifecycle = eventLifecycle(right, nowIso);
    const lifecycleDifference = rank[leftLifecycle] - rank[rightLifecycle];
    if (lifecycleDifference !== 0) return lifecycleDifference;

    const leftStart = new Date(left.startsAt).getTime();
    const rightStart = new Date(right.startsAt).getTime();
    const chronologicalDifference = leftLifecycle === "past"
      ? rightStart - leftStart
      : leftStart - rightStart;
    return chronologicalDifference || left.id.localeCompare(right.id);
  });
}

export function groupEventsByLifecycle<T extends EventInterval>(rows: readonly T[], nowIso: string): Record<EventLifecycle, T[]> {
  const groups: Record<EventLifecycle, T[]> = { current: [], upcoming: [], past: [] };
  for (const event of orderEventsByLifecycle(rows, nowIso)) groups[eventLifecycle(event, nowIso)].push(event);
  return groups;
}

export function nextEventLifecycleRefreshMs(rows: readonly EventInterval[], nowMs: number): number | null {
  const nextBoundary = rows
    .flatMap(({ startsAt, endsAt }) => [startsAt, endsAt])
    .map((value) => new Date(value).getTime())
    .filter((value) => value > nowMs)
    .sort((left, right) => left - right)[0];
  if (nextBoundary === undefined) return null;
  // Recompute just after the boundary so [start, end) classification has
  // definitely changed. Very distant events are revisited at the browser's
  // maximum timeout until their boundary is close enough.
  return Math.min(nextBoundary - nowMs + 25, MAX_BROWSER_TIMEOUT_MS);
}
