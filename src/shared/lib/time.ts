import { addMilliseconds, differenceInCalendarDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export type TimeStyle = "date" | "time" | "dateTime" | "long" | Intl.DateTimeFormatOptions;

function asDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export function zonedInputToUtc(localISO: string, timeZone: string): Date {
  return fromZonedTime(localISO, timeZone);
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
    // `dateStyle`/`timeStyle` cannot be mixed with component options, so the
    // shortcut form gets its default zone appended after Intl formats it.
    const appendShortcutZone = usesStyleShortcut && rendersTime && style.timeZoneName === undefined;
    const options: Intl.DateTimeFormatOptions = usesStyleShortcut
      ? { ...style, timeZone }
      : rendersTime
        ? { ...style, timeZone, timeZoneName: style.timeZoneName ?? "short" }
        : { ...style, timeZone };
    const rendered = new Intl.DateTimeFormat("en-US", options).format(value);
    return appendShortcutZone ? `${rendered} ${zoneAbbreviation(value, timeZone)}` : rendered;
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

export function zoneAbbreviation(utc: Date | string | number, timeZone: string): string {
  return formatInTimeZone(asDate(utc), timeZone, "zzz");
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
export function formatDateRangeInZone(
  startsAt: Date | string | number,
  endsAt: Date | string | number,
  timeZone: string,
): string {
  const start = localDateParts(startsAt, timeZone);
  const end = localDateParts(endsAt, timeZone);
  const startZone = zoneAbbreviation(startsAt, timeZone);
  const endZone = zoneAbbreviation(endsAt, timeZone);
  const full = (date: LocalDateParts) => `${date.month} ${date.day}, ${date.year}`;

  if (startZone !== endZone) return `${full(start)} ${startZone} – ${full(end)} ${endZone}`;
  if (start.year === end.year && start.month === end.month && start.day === end.day) return `${full(start)} ${endZone}`;
  if (start.year === end.year && start.month === end.month) return `${start.month} ${start.day} – ${end.day}, ${end.year} ${endZone}`;
  if (start.year === end.year) return `${start.month} ${start.day} – ${end.month} ${end.day}, ${end.year} ${endZone}`;
  return `${full(start)} – ${full(end)} ${endZone}`;
}
