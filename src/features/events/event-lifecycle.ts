export type EventLifecycle = "current" | "upcoming" | "past";

type EventInterval = { id: string; startsAt: string; endsAt: string };

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
