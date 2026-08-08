export type IcsEvent = { uid: string; sequence: number; startsAt: string; endsAt: string; summary: string; description: string; location: string; organizerEmail?: string; attendeeEmail?: string; status?: "CONFIRMED" | "CANCELLED" };

function escapeValue(value: string) { return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replace(/\r?\n/g, "\\n"); }
function utc(value: string) { return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); }
function fold(line: string) { const chunks: string[] = []; let rest = line; while (new TextEncoder().encode(rest).length > 75) { let cut = Math.min(73, rest.length); while (new TextEncoder().encode(rest.slice(0, cut)).length > 73) cut -= 1; chunks.push(rest.slice(0, cut)); rest = rest.slice(cut); } chunks.push(rest); return chunks.join("\r\n "); }

export function buildInvite(event: IcsEvent, method: "REQUEST" | "CANCEL" | "PUBLISH" = "REQUEST") {
  const lines = ["BEGIN:VCALENDAR", "PRODID:-//Openboard//Event Calendar//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", `METHOD:${method}`, "BEGIN:VEVENT", `UID:${event.uid}`, `SEQUENCE:${event.sequence}`, `DTSTAMP:${utc(new Date().toISOString())}`, `DTSTART:${utc(event.startsAt)}`, `DTEND:${utc(event.endsAt)}`, `SUMMARY:${escapeValue(event.summary)}`, `DESCRIPTION:${escapeValue(event.description)}`, `LOCATION:${escapeValue(event.location)}`, `STATUS:${event.status ?? (method === "CANCEL" ? "CANCELLED" : "CONFIRMED")}`];
  if (event.organizerEmail) lines.push(`ORGANIZER:mailto:${event.organizerEmail}`);
  if (event.attendeeEmail) lines.push(`ATTENDEE;RSVP=TRUE:mailto:${event.attendeeEmail}`);
  lines.push("END:VEVENT", "END:VCALENDAR", "");
  return lines.map(fold).join("\r\n");
}

export function buildFeed(name: string, events: IcsEvent[]) {
  const eventBlocks = events.map((event) => buildInvite(event, "PUBLISH").split("\r\n").slice(5, -3).join("\r\n"));
  return ["BEGIN:VCALENDAR", "PRODID:-//Openboard//Event Calendar//EN", "VERSION:2.0", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escapeValue(name)}`, ...eventBlocks, "END:VCALENDAR", ""].join("\r\n");
}
