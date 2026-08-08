export type Interval = { start: string | Date; end: string | Date };

export function overlaps(a: Interval, b: Interval) {
  return new Date(a.start).getTime() < new Date(b.end).getTime() && new Date(b.start).getTime() < new Date(a.end).getTime();
}
