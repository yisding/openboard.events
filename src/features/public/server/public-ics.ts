import type { DbOrTx } from "@/db/client";
import { buildFeed, icsUid, type IcsEvent } from "@/features/comms/ics";
import { stripHtml } from "@/features/comms/server/render";
import type { PublishedScheduleDTO } from "@/shared/contracts";
import { emailFromAddress, getEnv, type RuntimeEnv } from "@/shared/lib/env";
import { getPublishedSchedule, getPublishedScheduleIn } from "./public-queries";

/**
 * The anonymous itinerary export — see M53 work order's calendar-export
 * guardrail: "reuses M35's builder; do not create a second ICS
 * implementation." This is the one place a public, unauthenticated visitor's
 * selected session ids become an `.ics` file; it always re-reads the
 * *current* published schedule rather than trusting any client-carried
 * session data, which is what makes it safe against a session that was
 * unpublished or edited after the visitor starred it (the same
 * reconciliation `PublicItinerary`'s localStorage layer performs on read).
 */

function senderAddress(env: RuntimeEnv): string {
  if (env.EMAIL_FROM) {
    const address = emailFromAddress(env.EMAIL_FROM);
    if (address) return address;
  }
  const hostname = new URL(env.APP_BASE_URL).hostname;
  return `calendar@${hostname.includes(".") ? hostname : "openboard.local"}`;
}

function senderDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

export type PublicScheduleIcs = { calendarName: string; ics: string };

function renderPublicScheduleIcs(
  schedule: PublishedScheduleDTO,
  eventSlug: string,
  sessionIds: string[] | null,
  env: RuntimeEnv = getEnv(),
): PublicScheduleIcs {
  const selected = sessionIds === null
    ? schedule.sessions
    : schedule.sessions.filter((session) => sessionIds.includes(session.id));

  const organizerEmail = senderAddress(env);
  const organizerDomain = senderDomain(organizerEmail);
  const now = new Date();

  const events: IcsEvent[] = selected.map((session) => ({
    uid: icsUid(session.id, "public", organizerDomain),
    sequence: 0,
    method: null,
    startsAt: new Date(session.startsAt),
    endsAt: new Date(session.endsAt),
    dtstamp: now,
    summary: session.title,
    description: stripHtml(session.descriptionHtml ?? ""),
    location: session.room?.name ?? "",
    url: `${env.APP_BASE_URL}/e/${encodeURIComponent(eventSlug)}/agenda?session=${encodeURIComponent(session.id)}`,
    organizer: { name: schedule.event.name, email: organizerEmail },
  }));

  return { calendarName: schedule.event.name, ics: buildFeed(schedule.event.name, events) };
}

/**
 * `sessionIds` is `null` for "the whole published schedule" (used by the
 * agenda's "add all to calendar" affordance) and an array — possibly empty —
 * for "exactly these ids". An empty array is a real state (every starred
 * session removed) and yields a valid, empty calendar rather than an error or
 * a silent fallback to the full schedule; a non-empty array silently drops
 * any id that is no longer published, which is the removed/unpublished-id
 * reconciliation the M53 work order requires of the itinerary export.
 */
export async function buildPublicScheduleIcsIn(
  dbOrTx: DbOrTx,
  eventSlug: string,
  sessionIds: string[] | null,
  env: RuntimeEnv = getEnv(),
): Promise<PublicScheduleIcs | null> {
  const schedule = await getPublishedScheduleIn(dbOrTx, eventSlug);
  if (!schedule) return null;
  return renderPublicScheduleIcs(schedule, eventSlug, sessionIds, env);
}

export async function buildPublicScheduleIcs(eventSlug: string, sessionIds: string[] | null): Promise<PublicScheduleIcs | null> {
  const schedule = await getPublishedSchedule(eventSlug);
  return schedule ? renderPublicScheduleIcs(schedule, eventSlug, sessionIds) : null;
}
