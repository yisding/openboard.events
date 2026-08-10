import type { ScheduledSessionDTO } from "@/shared/contracts";
import { hourMinuteInZone } from "@/shared/lib/time";

/**
 * Pure grid layout math for the Day view. No React, no server calls — every
 * function here is minutes/pixels in, minutes/pixels out, so it can be unit
 * tested without a DOM and reused identically by the grid, the cards and the
 * resize handles.
 *
 * Every minutes-since-midnight value below is in the *event's* time zone, never
 * UTC and never the browser's local zone — the demo event is
 * America/Los_Angeles, and a machine running this in another zone would get
 * every conversion wrong without going through `hourMinuteInZone` here.
 */

/** One grid row per 15-minute increment — the brief's snap granularity. */
export const SLOT_MINUTES = 15;

/**
 * PROPOSED — not a literal number in any doc. Chosen to equal the slot size so
 * a resized session always spans at least one full row and never collapses to
 * zero height.
 */
export const MIN_SESSION_DURATION_MINUTES = 15;

/**
 * Pixels per 15-minute row. The single source both the grid's CSS grid track
 * size and the resize handles' pixel-to-slot math read from, so a row drawn at
 * one height and a drag measured against another can never drift apart.
 */
export const SLOT_ROW_HEIGHT_PX = 16;

const DEFAULT_GRID_START_MINUTES = 8 * 60;
const DEFAULT_GRID_END_MINUTES = 18 * 60;

export type GridRange = { gridStartMinutes: number; gridEndMinutes: number };

/** A session's start or end, as minutes-since-midnight in the event's zone. */
export function minutesSinceMidnightInZone(instant: string, timeZone: string): number {
  const { hour, minute } = hourMinuteInZone(instant, timeZone);
  return hour * 60 + minute;
}

/**
 * The day's visible row range, in event-tz minutes-since-midnight.
 *
 * Earliest start rounds down to the hour, latest end rounds up to the hour —
 * both computed in the event's own zone via `hourMinuteInZone`, never in UTC or
 * browser-local time, so a session starting 8:58am PT anchors the grid at
 * 8:00am PT regardless of where this code runs. A day with nothing scheduled
 * falls back to 08:00-18:00 so the grid still has drop targets for the first
 * drag-in.
 */
export function computeGridRange(
  sessions: readonly Pick<ScheduledSessionDTO, "startsAt" | "endsAt">[],
  timeZone: string,
): GridRange {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const session of sessions) {
    if (session.startsAt === null || session.endsAt === null) continue;
    const start = minutesSinceMidnightInZone(session.startsAt, timeZone);
    const end = minutesSinceMidnightInZone(session.endsAt, timeZone);
    if (start < earliest) earliest = start;
    if (end > latest) latest = end;
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) {
    return { gridStartMinutes: DEFAULT_GRID_START_MINUTES, gridEndMinutes: DEFAULT_GRID_END_MINUTES };
  }
  const gridStartMinutes = Math.floor(earliest / 60) * 60;
  const gridEndMinutes = Math.max(Math.ceil(latest / 60) * 60, gridStartMinutes + 60);
  return { gridStartMinutes, gridEndMinutes };
}

/** A 1-based CSS grid row line, relative to the range's start. */
export function minutesToGridRow(minutes: number, gridStartMinutes: number): number {
  return Math.round((minutes - gridStartMinutes) / SLOT_MINUTES) + 1;
}

/** The inverse of `minutesToGridRow` — a slot row's own start time. */
export function gridRowToMinutes(row: number, gridStartMinutes: number): number {
  return gridStartMinutes + (row - 1) * SLOT_MINUTES;
}

export function gridRowCount(range: GridRange): number {
  return Math.max(1, Math.round((range.gridEndMinutes - range.gridStartMinutes) / SLOT_MINUTES));
}

const MINUTES_PER_DAY = 24 * 60;

/** `yyyy-MM-dd` shifted by whole calendar days. Pure date arithmetic on the day
 * key — no zone involved, because the key *is* the wall date and
 * `zonedInputToUtc` does the conversion afterwards. */
function shiftDayKey(day: string, offsetDays: number): string {
  if (offsetDays === 0) return day;
  const anchor = new Date(`${day}T00:00:00.000Z`);
  anchor.setUTCDate(anchor.getUTCDate() + offsetDays);
  return anchor.toISOString().slice(0, 10);
}

/**
 * `${day}Thh:mm:00` — the local-wall-time string `zonedInputToUtc` expects,
 * from a day key plus minutes-since-midnight in the event's zone.
 *
 * **The normalization is the point.** Callers hand in minutes that legitimately
 * fall outside the day: a drop in the last slot plus a format duration overshoots
 * midnight, and a start-edge resize dragged above the first row goes negative.
 * Formatting those verbatim produces `T24:45:00` — which `date-fns-tz` parses as
 * **00:45 of the same day**, silently writing an end before its start — or
 * `T25:00:00`/`T-1:30:00`, which throw `Invalid time value` inside the drag
 * handler. Rolling the overflow onto the date is the only reading that keeps a
 * cross-midnight drag meaning what the organizer did.
 */
export function localWallTimeAt(day: string, minutes: number): string {
  const dayOffset = Math.floor(minutes / MINUTES_PER_DAY);
  const minuteOfDay = minutes - dayOffset * MINUTES_PER_DAY;
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const mm = String(minuteOfDay % 60).padStart(2, "0");
  return `${shiftDayKey(day, dayOffset)}T${hh}:${mm}:00`;
}

/** Pixels moved -> whole slots moved, rounding the *delta* rather than the
 * absolute drop position. This is the specific mechanism that keeps a pointer
 * jiggle under half a row from resizing anything (agenda-embeds.md edge case
 * #5) — a tiny unintentional movement rounds to zero slots and changes nothing. */
export function pixelDeltaToSlotDelta(deltaPx: number): number {
  return Math.round(deltaPx / SLOT_ROW_HEIGHT_PX);
}

/**
 * Clamp a resize so the duration never drops below `MIN_SESSION_DURATION_MINUTES`
 * and the dragged boundary never crosses the other one.
 *
 * This is a UX nicety, not the guard — `moveSession`'s zod schema re-validates
 * `endsAt > startsAt` server-side regardless (never trust the client).
 */
export function clampResize(
  edge: "start" | "end",
  startMinutes: number,
  endMinutes: number,
  deltaSlots: number,
): { startMinutes: number; endMinutes: number } {
  const deltaMinutes = deltaSlots * SLOT_MINUTES;
  if (edge === "start") {
    const proposed = startMinutes + deltaMinutes;
    return { startMinutes: Math.min(proposed, endMinutes - MIN_SESSION_DURATION_MINUTES), endMinutes };
  }
  const proposed = endMinutes + deltaMinutes;
  return { startMinutes, endMinutes: Math.max(proposed, startMinutes + MIN_SESSION_DURATION_MINUTES) };
}
