import { addMilliseconds, differenceInCalendarDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export type TimeStyle = "date" | "time" | "dateTime" | "long" | Intl.DateTimeFormatOptions;

function asDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export function zonedInputToUtc(localISO: string, timeZone: string): Date {
  return fromZonedTime(localISO, timeZone);
}

/**
 * The zone the *viewer's* browser is in — never a substitute for an event's
 * own timezone, which is what `TzTime` renders. Use it only where there is no
 * event in scope (organization-wide screens) and only after mount: on the
 * server this resolves to the Worker's zone, so rendering with it during SSR
 * is exactly the hydration mismatch `LocalTime` exists to avoid.
 */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function formatInZone(utc: Date | string | number, timeZone: string, style: TimeStyle): string {
  const value = asDate(utc);
  if (typeof style === "object") {
    const usesStyleShortcut = style.dateStyle !== undefined || style.timeStyle !== undefined;
    const rendersTime = style.timeStyle !== undefined
      || style.hour !== undefined
      || style.minute !== undefined
      || style.second !== undefined;
    // A zone belongs to an instant, not a calendar label. Adding one to a
    // date-only component format makes Intl join it as “August 12 at PDT”.
    // `dateStyle`/`timeStyle` cannot be mixed with component options. Shortcut
    // callers compose ranges and other prose, so they opt into a zone through
    // `TzTime` or a separate `zoneAbbreviation` token instead.
    const options: Intl.DateTimeFormatOptions = usesStyleShortcut
      ? { ...style, timeZone }
      : rendersTime
        ? { ...style, timeZone, timeZoneName: style.timeZoneName ?? "short" }
        : { ...style, timeZone };
    const rendered = new Intl.DateTimeFormat("en-US", options).format(value);
    return rendered;
  }
  const pattern = style === "date" ? "MMM d, yyyy" : style === "time" ? "h:mm a" : style === "long" ? "MMMM d, yyyy 'at' h:mm a" : "MMM d, yyyy, h:mm a";
  return formatInTimeZone(value, timeZone, `${pattern} zzz`);
}

export function eventDayKey(utc: Date | string | number, timeZone: string): string {
  return formatInTimeZone(asDate(utc), timeZone, "yyyy-MM-dd");
}

/**
 * Format an event-local calendar key without first treating it as a UTC date.
 *
 * A key such as `2026-09-15` names September 15 in the event timezone; it is
 * not an instant. Converting a UTC-noon pivot into UTC+12/+14 advances that
 * pivot to September 16. Anchoring noon in the event timezone and formatting
 * it back in the same zone preserves the calendar date in every offset. Day
 * labels intentionally omit a zone suffix: the event-local date is already
 * the context, and repeating `PDT` on both the weekday and date is noise.
 */
export function formatDayKeyInZone(dayKey: string, timeZone: string, style: Intl.DateTimeFormatOptions): string {
  const localNoon = zonedInputToUtc(`${dayKey}T12:00:00`, timeZone);
  return new Intl.DateTimeFormat("en-US", { ...style, timeZone }).format(localNoon);
}

export function endOfDayInTz(dateISO: string, timeZone: string): Date {
  return fromZonedTime(`${dateISO}T23:59:59.999`, timeZone);
}

/**
 * The first instant that belongs to a day in a zone.
 *
 * Not `fromZonedTime(`${day}T00:00:00`)`: in a zone whose clock jumps forward
 * at midnight, that wall time does not exist and `fromZonedTime` resolves it
 * *backwards* into the previous day. `America/Havana` on 2026-03-08 renders back
 * as `2026-03-07 23:00`; so do `America/Santiago` on 2026-09-06 and
 * `Asia/Beirut` on 2026-03-29. A day window built that way is 25 hours long and
 * overlaps its predecessor.
 *
 * Derived from the previous day's last millisecond instead, which always exists,
 * so the result is the first real instant of `dateISO` whatever the clock did.
 */
export function startOfDayInTz(dateISO: string, timeZone: string): Date {
  return new Date(endOfDayInTz(shiftDayKey(dateISO, -1), timeZone).getTime() + 1);
}

/**
 * Calendar-day arithmetic on a `YYYY-MM-DD` key, with no instant in sight.
 *
 * Stepping a cursor by 24 hours of absolute milliseconds is not the same thing:
 * across a spring-forward the local time-of-day gains an hour, so a cursor that
 * starts late in the evening rolls past midnight twice and the loop skips a
 * calendar day entirely.
 */
export function shiftDayKey(dateISO: string, offsetDays: number): string {
  if (offsetDays === 0) return dateISO;
  const anchor = new Date(`${dateISO}T00:00:00.000Z`);
  anchor.setUTCDate(anchor.getUTCDate() + offsetDays);
  return anchor.toISOString().slice(0, 10);
}

export function daysToEvent(nowUtc: Date, eventStartUtc: Date, timeZone: string): number {
  const nowDay = new Date(`${eventDayKey(nowUtc, timeZone)}T12:00:00.000Z`);
  const eventDay = new Date(`${eventDayKey(eventStartUtc, timeZone)}T12:00:00.000Z`);
  return differenceInCalendarDays(eventDay, nowDay);
}

export function addDuration(utc: Date, isoDuration: string): Date {
  const match = /^P(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(isoDuration);
  if (!match || !match.slice(1).some((component) => component !== undefined)) throw new TypeError(`Unsupported ISO duration: ${isoDuration}`);
  const totalSeconds = Number(match[1] ?? 0) * 86_400
    + Number(match[2] ?? 0) * 3_600
    + Number(match[3] ?? 0) * 60
    + Number(match[4] ?? 0);
  return addMilliseconds(utc, totalSeconds * 1000);
}

// Compatibility helpers for the merged local demo. Server-backed consumers use
// the six canonical functions above.
export function dayInZone(utc: Date | string | number, timeZone: string): number {
  return Number(eventDayKey(utc, timeZone).slice(-2));
}

export function zonedTimeToInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const localISO = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  return zonedInputToUtc(localISO, timeZone);
}

export function hourMinuteInZone(utc: Date | string | number, timeZone: string): { hour: number; minute: number } {
  const rendered = formatInTimeZone(asDate(utc), timeZone, "HH:mm");
  const [hour = 0, minute = 0] = rendered.split(":").map(Number);
  return { hour, minute };
}

/**
 * Whether a `YYYY-MM-DDTHH:mm[:ss]` wall time actually occurs in `timeZone`.
 *
 * On a spring-forward date an hour of the local clock does not exist, and
 * `zonedInputToUtc` (`fromZonedTime`) resolves such a time *backwards* to the
 * pre-transition offset rather than rejecting it: in `America/New_York` on
 * 2026-03-08, `T02:00` yields the instant that renders as `01:00`. The clock
 * therefore runs backwards as the requested minute goes up, so a caller that
 * derives two edges from adjacent minutes can produce an end before its start.
 *
 * Round-tripping the instant back through the zone is the only reliable test:
 * a real wall time renders as itself, a skipped one renders as something else.
 *
 * The read-back goes through `Intl` rather than `formatInTimeZone`, which gets
 * this specific comparison wrong: asked to render the instant `2026-03-08T02:00Z`
 * in `UTC` it answers `03:00`, so a zone with no DST at all would be reported as
 * skipping an hour. `Intl.DateTimeFormat` is the platform's own zone database
 * and agrees with the instant in every case.
 */
export function wallTimeExistsInZone(localISO: string, timeZone: string): boolean {
  const instant = zonedInputToUtc(localISO, timeZone);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(instant).map((part) => [part.type, part.value]),
  );
  // `hour12: false` renders midnight as `24` in some ICU versions.
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}` === localISO.slice(0, 16);
}

export function zoneAbbreviation(utc: Date | string | number, timeZone: string): string {
  return formatInTimeZone(asDate(utc), timeZone, "zzz");
}

/** The zone a new event starts in when nothing better is known. */
export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

const FALLBACK_TIME_ZONES = [
  DEFAULT_TIME_ZONE, "America/New_York", "America/Chicago", "America/Denver",
  "Europe/London", "Europe/Paris", "Asia/Tokyo", "UTC",
];

/**
 * Every zone the *rendering runtime* knows, with `UTC` guaranteed present.
 *
 * The list is CLDR data read from whichever ICU build is executing, so it is
 * only stable within one runtime — see `TimeZoneSelect`, which is why the
 * picker does not server-render it. The hand-written fallback covers a runtime
 * without `Intl.supportedValuesOf` (or one that answers with nothing), so a
 * caller always has something to offer.
 */
export function browserTimeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    if (zones.length === 0) return FALLBACK_TIME_ZONES;
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return FALLBACK_TIME_ZONES;
  }
}

const timeZoneOptionLabelCache = new Map<string, string>();

/**
 * A readable label for timezone selectors while the option value remains the
 * canonical IANA identifier used by the API and date math.
 *
 * `America/Los_Angeles` is useful to software, but organizers scan a long
 * native select more easily when it starts with “Pacific Time”. The location
 * suffix keeps zones with the same generic name distinguishable. A fixed
 * instant makes the generic label deterministic across seasons instead of
 * letting the current DST boundary rename options during hydration.
 */
export function timeZoneOptionLabel(timeZone: string): string {
  const cached = timeZoneOptionLabelCache.get(timeZone);
  if (cached) return cached;
  if (timeZone === "UTC" || timeZone === "Etc/UTC" || timeZone === "Etc/GMT") {
    timeZoneOptionLabelCache.set(timeZone, "UTC");
    return "UTC";
  }
  const segments = timeZone.split("/");
  const location = (segments.at(-1) ?? timeZone).replaceAll("_", " ");
  let label: string | undefined;
  try {
    const genericName = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longGeneric",
    }).formatToParts(new Date("2026-01-15T12:00:00.000Z"))
      .find((part) => part.type === "timeZoneName")?.value;
    if (genericName && genericName !== timeZone) {
      label = segments[0] === "Etc" ? genericName : `${genericName} — ${location}`;
    }
  } catch {
    // Unsupported identifiers still get a readable fallback for recovery UIs.
  }
  label ??= segments.map((segment) => segment.replaceAll("_", " ")).join(" — ");
  timeZoneOptionLabelCache.set(timeZone, label);
  return label;
}

type LocalDateParts = { year: string; month: string; day: string };

function localDateParts(utc: Date | string | number, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).formatToParts(asDate(utc));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: value("year"), month: value("month"), day: value("day") };
}

/**
 * A compact event date range with one zone label when both endpoints share it.
 *
 * `formatInZone(..., "date")` correctly labels every standalone date, but
 * joining two of those strings repeats the zone and makes the range read like
 * “Oct 16, 2026 PDT – Oct 18, 2026 PDT”. Public heroes, event cards, and the
 * event switcher all need the range-shaped version instead. A range crossing a
 * DST boundary keeps both labels because they genuinely differ.
 */
/**
 * `showZone: false` drops the trailing abbreviation.
 *
 * A zone qualifies a *time*. On a span of whole days it qualifies nothing —
 * "Oct 19 – 21, 2026 PDT" tells a reader no more than "Oct 19 – 21, 2026" and
 * asks them to parse three more characters to find that out. It stays on by
 * default because a list of many events does use it to say which zone each one
 * runs in; the public hero, which is one event and no times, does not.
 *
 * A range that *crosses* zones keeps both abbreviations either way: there the
 * zone is the only thing explaining why the two dates are qualified at all.
 */
export function formatDateRangeInZone(
  startsAt: Date | string | number,
  endsAt: Date | string | number,
  timeZone: string,
  { showZone = true }: { showZone?: boolean } = {},
): string {
  const start = localDateParts(startsAt, timeZone);
  const end = localDateParts(endsAt, timeZone);
  const startZone = zoneAbbreviation(startsAt, timeZone);
  const endZone = zoneAbbreviation(endsAt, timeZone);
  const full = (date: LocalDateParts) => `${date.month} ${date.day}, ${date.year}`;
  const zone = showZone ? ` ${endZone}` : "";

  if (startZone !== endZone) return `${full(start)} ${startZone} – ${full(end)} ${endZone}`;
  if (start.year === end.year && start.month === end.month && start.day === end.day) return `${full(start)}${zone}`;
  if (start.year === end.year && start.month === end.month) return `${start.month} ${start.day} – ${end.day}, ${end.year}${zone}`;
  if (start.year === end.year) return `${start.month} ${start.day} – ${end.month} ${end.day}, ${end.year}${zone}`;
  return `${full(start)} – ${full(end)}${zone}`;
}

type LocalTimeParts = { hour: string; minute: string; dayPeriod: string };

function localTimeParts(utc: Date | string | number, timeZone: string): LocalTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(asDate(utc));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { hour: value("hour"), minute: value("minute"), dayPeriod: value("dayPeriod") };
}

/**
 * A compact event-local time range with one shared day period and zone when
 * possible. Phone cards should read “9:00–9:45 AM PDT”, not repeat “AM PDT”
 * on both endpoints; a meridiem or DST transition keeps the labels that
 * actually differ.
 */
export function formatTimeRangeInZone(
  startsAt: Date | string | number,
  endsAt: Date | string | number,
  timeZone: string,
): string {
  const start = localTimeParts(startsAt, timeZone);
  const end = localTimeParts(endsAt, timeZone);
  const startClock = `${start.hour}:${start.minute}`;
  const endClock = `${end.hour}:${end.minute}`;
  const startZone = zoneAbbreviation(startsAt, timeZone);
  const endZone = zoneAbbreviation(endsAt, timeZone);

  if (startZone !== endZone) {
    return `${startClock} ${start.dayPeriod} ${startZone}–${endClock} ${end.dayPeriod} ${endZone}`;
  }
  if (start.dayPeriod !== end.dayPeriod) {
    return `${startClock} ${start.dayPeriod}–${endClock} ${end.dayPeriod} ${endZone}`;
  }
  return `${startClock}–${endClock} ${end.dayPeriod} ${endZone}`;
}
