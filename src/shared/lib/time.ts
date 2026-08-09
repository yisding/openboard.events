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
    const options: Intl.DateTimeFormatOptions = usesStyleShortcut
      ? { ...style, timeZone }
      : { ...style, timeZone, timeZoneName: style.timeZoneName ?? "short" };
    const rendered = new Intl.DateTimeFormat("en-US", options).format(value);
    return rendered;
  }
  const pattern = style === "date" ? "MMM d, yyyy" : style === "time" ? "h:mm a" : style === "long" ? "MMMM d, yyyy 'at' h:mm a" : "MMM d, yyyy, h:mm a";
  return formatInTimeZone(value, timeZone, `${pattern} zzz`);
}

export function eventDayKey(utc: Date | string | number, timeZone: string): string {
  return formatInTimeZone(asDate(utc), timeZone, "yyyy-MM-dd");
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
