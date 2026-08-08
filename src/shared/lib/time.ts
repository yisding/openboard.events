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
