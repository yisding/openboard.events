import { AppError } from "@/shared/lib/errors";

export type IcsEvent = {
  uid: string;
  sequence: number;
  method: "REQUEST" | "CANCEL" | null;
  startsAt: Date;
  endsAt: Date;
  dtstamp: Date;
  summary: string;
  description: string;
  location: string;
  url: string;
  organizer: { name: string; email: string };
  attendee?: { name: string; email: string };
  cancelled?: boolean;
};

const CRLF = "\r\n";
const encoder = new TextEncoder();

function escapeText(value: string): string {
  return value
    .replaceAll("\r", "")
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

function quoteParameter(value: string): string {
  const encoded = value
    .replaceAll("^", "^^")
    .replace(/\r\n|\r|\n/g, "^n")
    .replaceAll('"', "^'");
  return `"${encoded}"`;
}

function utc(value: Date): string {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function fold(line: string): string {
  const chunks: string[] = [];
  let chunk = "";
  let limit = 75;

  for (const character of line) {
    if (chunk && encoder.encode(chunk + character).length > limit) {
      chunks.push(chunk);
      chunk = character;
      limit = 74;
    } else {
      chunk += character;
    }
  }

  chunks.push(chunk);
  return chunks.map((value, index) => (index === 0 ? value : ` ${value}`)).join(CRLF);
}

function eventLines(event: IcsEvent): string[] {
  if (event.method !== null && !event.attendee) {
    throw new AppError("VALIDATION", `${event.method} calendar invites require an attendee`);
  }

  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${utc(event.dtstamp)}`,
    `DTSTART:${utc(event.startsAt)}`,
    `DTEND:${utc(event.endsAt)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    `LOCATION:${escapeText(event.location)}`,
    `URL:${event.url}`,
    `STATUS:${event.cancelled || event.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    `ORGANIZER;CN=${quoteParameter(event.organizer.name)}:mailto:${event.organizer.email}`,
  ];

  if (event.attendee) {
    lines.push(
      `ATTENDEE;CN=${quoteParameter(event.attendee.name)};PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${event.attendee.email}`,
    );
  }

  lines.push(`LAST-MODIFIED:${utc(event.dtstamp)}`, "END:VEVENT");
  return lines;
}

function calendar(lines: string[]): string {
  return `${lines.map(fold).join(CRLF)}${CRLF}`;
}

export function buildInvite(event: IcsEvent): string {
  return calendar([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//openboard//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${event.method ?? "PUBLISH"}`,
    ...eventLines(event),
    "END:VCALENDAR",
  ]);
}

export function buildFeed(name: string, events: IcsEvent[]): string {
  return calendar([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//openboard//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(name)}`,
    ...events.flatMap((event) => eventLines({ ...event, method: null })),
    "END:VCALENDAR",
  ]);
}

export function googleCalendarUrl(event: IcsEvent): string {
  const parameters: Array<[string, string]> = [
    ["action", "TEMPLATE"],
    ["text", event.summary],
    ["dates", `${utc(event.startsAt)}/${utc(event.endsAt)}`],
    ["details", event.description],
    ["location", event.location],
  ];
  const query = parameters
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `https://calendar.google.com/calendar/render?${query}`;
}

export function outlookCalendarUrl(event: IcsEvent): string {
  const parameters: Array<[string, string]> = [
    ["path", "/calendar/action/compose"],
    ["rru", "addevent"],
    ["subject", event.summary],
    ["startdt", event.startsAt.toISOString()],
    ["enddt", event.endsAt.toISOString()],
    ["location", event.location],
    ["body", event.description],
  ];
  const query = parameters
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return `https://outlook.live.com/calendar/0/deeplink/compose?${query}`;
}

export function icsUid(sessionId: string, contactId: string, domain: string): string {
  return `sess-${sessionId}-spk-${contactId}@${domain}`;
}
