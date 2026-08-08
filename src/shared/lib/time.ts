// All schedule-facing dates render in the event's IANA timezone, never the
// viewer's browser timezone.
export function formatInZone(instant: string | number | Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(new Date(instant));
}
