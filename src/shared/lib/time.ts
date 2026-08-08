// All schedule-facing dates render in the event's IANA timezone, never the
// viewer's browser timezone.
export function formatInZone(instant: string | number | Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(new Date(instant));
}

// Day-of-month in the event timezone — a 5 PM PDT session belongs to its PDT
// calendar day even though its UTC timestamp is already the next day.
export function dayInZone(instant: string | number | Date, timeZone: string) {
  return Number(new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone }).format(new Date(instant)));
}

function offsetAt(instantMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(instantMs);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - instantMs;
}

// Convert an event-local wall-clock time to a UTC instant for any IANA zone.
// Two passes handle the offset changing across a DST boundary.
export function zonedTimeToInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const refined = guess - offsetAt(guess, timeZone);
  return new Date(guess - offsetAt(refined, timeZone));
}

export function hourMinuteInZone(instant: string | number | Date, timeZone: string) {
  const [hour = 0, minute = 0] = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(instant)).split(":").map(Number);
  return { hour: hour % 24, minute };
}

// Short zone label like "PDT" for UI copy.
export function zoneAbbreviation(instant: string | number | Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(new Date(instant)).find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}
