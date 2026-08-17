import type { ScheduledSessionDTO } from "@/shared/contracts";
import { eventDayKey, hourMinuteInZone, shiftDayKey } from "@/shared/lib/time";

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

const MINUTES_PER_DAY = 24 * 60;

/**
 * PROPOSED — not a literal number in any doc. Chosen to equal the slot size so
 * a resized session always spans at least one full row and never collapses to
 * zero height.
 */
const MIN_SESSION_DURATION_MINUTES = 15;

/**
 * Pixels per 15-minute row. The single source both the grid's CSS grid track
 * size and the resize handles' pixel-to-slot math read from, so a row drawn at
 * one height and a drag measured against another can never drift apart.
 *
 * 20, not the original 16 (#648) — a 15-minute row that short left every card
 * shorter than half an hour fighting its own padding for room to draw a title,
 * a time and a conflict badge without clipping. The extra 4px/row compounds
 * fast (a 30-minute card gains 8px, an hour-long one 16px) without pushing a
 * typical 8am-6pm day past a comfortable scroll.
 */
export const SLOT_ROW_HEIGHT_PX = 20;

/** A room column with nothing overlapping: the width family every room starts in. */
export const ROOM_MIN_WIDTH_PX = 160;

/**
 * The minimum width one *lane* of a double-booked room gets.
 *
 * Measured against the card, not picked for looks. A lane card is
 * `calc(100%/lanes - 8px)` of its column and spends ~34px of that on its
 * borders, its text padding and the 24px right gutter the conflict triangle
 * sits in, so a 340px lane leaves ~298px of text box — enough for the seeded
 * room-conflict pair ("⚠ Demo conflict A — Vector search at scale", ~250px at
 * `--text-xs`) to render whole. A 45-minute card draws its title on one
 * `text-overflow:ellipsis` line, so a narrower lane does not wrap it, it
 * truncates it, and e2e/agenda-schedule.spec.ts asserts the opposite
 * (`scrollWidth <= clientWidth` on both cards of the side-by-side pair).
 *
 * The cost is that a five-room day with one busy room overflows `.dv-scroll`
 * horizontally — which is what that scroller is for. Buying the room back for
 * real means reflowing the day view's two 220px rails (the promotion tray and
 * `.dv-side-panels`), a layout decision rather than a track size.
 */
export const LANE_MIN_WIDTH_PX = 340;

/**
 * One room column's `grid-template-columns` entry. The `Nfr` maximum still
 * gives a busy room proportionally more width whenever the viewport has it to
 * give; only the floor differs.
 */
export function roomTrackSize(laneCount: number): string {
  const lanes = Math.max(1, Math.round(laneCount));
  return lanes > 1
    ? `minmax(${lanes * LANE_MIN_WIDTH_PX}px, ${lanes}fr)`
    : `minmax(${ROOM_MIN_WIDTH_PX}px, 1fr)`;
}

const DEFAULT_GRID_START_MINUTES = 8 * 60;
const DEFAULT_GRID_END_MINUTES = 18 * 60;

export type GridRange = { gridStartMinutes: number; gridEndMinutes: number };

/** A session's start or end, as minutes-since-midnight in the event's zone. */
function minutesSinceMidnightInZone(instant: string, timeZone: string): number {
  const { hour, minute } = hourMinuteInZone(instant, timeZone);
  return hour * 60 + minute;
}

/**
 * An instant's position on `day`'s grid: minutes from that day's midnight on the
 * **wall clock** of the event's zone, so an instant on the next calendar day
 * comes back >= 1440 and `localWallTimeAt` rolls it correctly onto that day.
 *
 * Wall clock rather than elapsed minutes, which is the whole reason this exists.
 * A session ending at 00:00 the next morning has `minutesSinceMidnightInZone` 0
 * — below its own start, which would make `clampResize` reorder the edges — so
 * the end has to carry a day offset. Deriving that offset from the *elapsed*
 * UTC duration instead is wrong across a DST transition: in America/New_York on
 * the fall-back day a 00:30-02:30 session runs three elapsed hours, which would
 * place its end at 03:30 and shift the session by an hour the moment either
 * edge is dragged. The calendar-day difference keeps both readings in the same
 * wall-clock frame the grid is drawn in.
 */
export function minutesFromDayStartInZone(instant: string, day: string, timeZone: string): number {
  const dayOffset = Math.round(
    (Date.parse(`${eventDayKey(instant, timeZone)}T00:00:00.000Z`) - Date.parse(`${day}T00:00:00.000Z`))
    / (MINUTES_PER_DAY * 60_000),
  );
  return minutesSinceMidnightInZone(instant, timeZone) + dayOffset * MINUTES_PER_DAY;
}

/**
 * How long a session is *as the grid draws it*, in wall-clock minutes.
 *
 * The same frame `minutesFromDayStartInZone` establishes, for the same reason:
 * elapsed UTC and wall-clock length differ by an hour across a DST transition,
 * so measuring one and re-applying it as the other moves the session. A
 * 01:00–02:00 session on a fall-back day is two elapsed hours and one drawn
 * hour; dragging it with the elapsed figure re-laid it as two hours.
 */
export function wallClockDurationMinutes(startsAt: string, endsAt: string, day: string, timeZone: string): number {
  const start = minutesFromDayStartInZone(startsAt, day, timeZone);
  const end = minutesFromDayStartInZone(endsAt, day, timeZone);
  return Math.max(MIN_SESSION_DURATION_MINUTES, end - start);
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
 *
 * Both edges are read against `day` rather than as bare minutes-since-midnight,
 * for the reason `minutesFromDayStartInZone` documents: an evening session
 * ending at 00:30 the next morning would otherwise report an end of 30 and
 * never raise `latest`, collapsing the grid above its own start. The end is
 * capped at midnight so the day view still draws exactly one day — a session
 * running past it renders flush against the last row via day-grid's
 * `Math.min(rowCount + 1, ...)` clamp.
 */
export function computeGridRange(
  sessions: readonly Pick<ScheduledSessionDTO, "startsAt" | "endsAt">[],
  day: string | null,
  timeZone: string,
): GridRange {
  let earliest = Infinity;
  let latest = -Infinity;
  // A null day means the event has no days to draw a grid against at all, so
  // nothing is measured and the fallback range below is what renders.
  if (day !== null) {
    for (const session of sessions) {
      if (session.startsAt === null || session.endsAt === null) continue;
      const start = minutesFromDayStartInZone(session.startsAt, day, timeZone);
      const end = minutesFromDayStartInZone(session.endsAt, day, timeZone);
      if (start < earliest) earliest = start;
      if (end > latest) latest = end;
    }
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) {
    return { gridStartMinutes: DEFAULT_GRID_START_MINUTES, gridEndMinutes: DEFAULT_GRID_END_MINUTES };
  }
  const gridStartMinutes = Math.floor(earliest / 60) * 60;
  const gridEndMinutes = Math.max(Math.min(Math.ceil(latest / 60) * 60, MINUTES_PER_DAY), gridStartMinutes + 60);
  return { gridStartMinutes, gridEndMinutes };
}

/** A 1-based CSS grid row line, relative to the range's start. */
export function minutesToGridRow(minutes: number, gridStartMinutes: number): number {
  return Math.round((minutes - gridStartMinutes) / SLOT_MINUTES) + 1;
}

export function gridRowCount(range: GridRange): number {
  return Math.max(1, Math.round((range.gridEndMinutes - range.gridStartMinutes) / SLOT_MINUTES));
}

/** `yyyy-MM-dd` shifted by whole calendar days. Pure date arithmetic on the day
 * key — no zone involved, because the key *is* the wall date and
 * `zonedInputToUtc` does the conversion afterwards. */
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

/**
 * A slot start as a wall-clock label — `555 -> "9:15 AM"`. Used by the Day
 * view's drag announcements, which must name a room and a time rather than the
 * cell id a screen reader would otherwise be read.
 */
export function slotTimeLabel(minutes: number): string {
  const minuteOfDay = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour24 = Math.floor(minuteOfDay / 60);
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour}:${String(minuteOfDay % 60).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
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
