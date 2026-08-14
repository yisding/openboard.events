import { googleCalendarUrl, outlookCalendarUrl } from "@/features/comms/index.calendar";
import type { MySessionDTO } from "@/shared/contracts";

/**
 * M59 — "Calendar where they look," the deeplink half. No token, no round
 * trip: `googleCalendarUrl`/`outlookCalendarUrl` (M35) only need the session's
 * own fields, which the portal home already has, so these render as plain
 * `<a>` hrefs straight out of server-side data.
 */
export type SessionCalendarLinks = { google: string; outlook: string };

export function sessionCalendarLinks(session: MySessionDTO, eventName: string, sessionUrl: string): SessionCalendarLinks | null {
  // Both ends have to be known to add anything to a calendar — a session the
  // agenda has not timed yet has nothing here to render.
  if (!session.startsAt || !session.endsAt) return null;
  const event = {
    uid: `session-${session.sessionId}`,
    sequence: 0,
    method: null,
    startsAt: new Date(session.startsAt),
    endsAt: new Date(session.endsAt),
    dtstamp: new Date(),
    summary: session.title,
    description: `Your session at ${eventName}.`,
    location: [session.roomName, eventName].filter(Boolean).join(" · "),
    url: sessionUrl,
    organizer: { name: eventName, email: "" },
  } as const;
  return { google: googleCalendarUrl(event), outlook: outlookCalendarUrl(event) };
}
