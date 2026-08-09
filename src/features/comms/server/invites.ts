import { and, asc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { calendarInvites, contacts, events, rooms, sessions, sessionSpeakers, tracks } from "@/db/schema";
import { issuePortalToken } from "@/features/auth";
import { buildFeed, buildInvite, googleCalendarUrl, icsUid, outlookCalendarUrl, type IcsEvent } from "@/features/comms/ics";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { getEnv, type RuntimeEnv } from "@/shared/lib/env";
import { log } from "@/shared/lib/log";
import { stripHtml } from "./render";
import type { OutboxRow } from "./context";

type InviteRow = OutboxRow & { contactId: string; sessionId: string };

export type PreparedInvite = {
  ics: string;
  filename: "invite.ics";
  contentType: string;
  uid: string;
  sequence: number;
  method: "REQUEST" | "CANCEL";
  attendeeEmail: string;
  googleUrl: string;
  outlookUrl: string;
  downloadUrl: string;
};

type PrepareOptions = { downloadUrl?: string; now?: Date };

function senderAddress(env: RuntimeEnv): string {
  if (env.EMAIL_FROM) return env.EMAIL_FROM;
  const hostname = new URL(env.APP_BASE_URL).hostname;
  return `calendar@${hostname.includes(".") ? hostname : "openboard.local"}`;
}

function senderDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}

export async function prepareInviteIn(
  dbOrTx: DbOrTx,
  row: InviteRow,
  env: RuntimeEnv,
  options: PrepareOptions = {},
): Promise<PreparedInvite | null> {
  if (row.templateKey !== "schedule_assigned" && row.templateKey !== "schedule_changed") return null;

  const [record] = await dbOrTx.select({
    title: sessions.title,
    descriptionHtml: sessions.descriptionHtml,
    startsAt: sessions.startsAt,
    endsAt: sessions.endsAt,
    status: sessions.status,
    scheduleRevision: sessions.scheduleRevision,
    room: rooms.name,
    track: tracks.name,
    eventName: events.name,
    eventSlug: events.slug,
    eventLocation: events.location,
    eventStartsAt: events.startsAt,
    eventEndsAt: events.endsAt,
    attendeeEmail: contacts.email,
    attendeeFirstName: contacts.firstName,
    attendeeLastName: contacts.lastName,
    speakerContactId: sessionSpeakers.contactId,
  }).from(sessions)
    .innerJoin(events, and(eq(events.id, sessions.eventId), eq(events.id, row.eventId)))
    .leftJoin(sessionSpeakers, and(
      eq(sessionSpeakers.eventId, sessions.eventId),
      eq(sessionSpeakers.sessionId, sessions.id),
      eq(sessionSpeakers.contactId, row.contactId),
    ))
    .innerJoin(contacts, and(eq(contacts.id, row.contactId), eq(contacts.eventId, sessions.eventId)))
    .leftJoin(rooms, and(eq(rooms.id, sessions.roomId), eq(rooms.eventId, sessions.eventId)))
    .leftJoin(tracks, and(eq(tracks.id, sessions.trackId), eq(tracks.eventId, sessions.eventId)))
    .where(and(eq(sessions.id, row.sessionId), eq(sessions.eventId, row.eventId)))
    .limit(1);
  if (!record) return null;

  const [existing] = await dbOrTx.select({
    lastMethod: calendarInvites.lastMethod,
    sequence: calendarInvites.sequence,
    icsUid: calendarInvites.icsUid,
    organizerEmail: calendarInvites.organizerEmail,
  })
    .from(calendarInvites)
    .where(and(
      eq(calendarInvites.eventId, row.eventId),
      eq(calendarInvites.contactId, row.contactId),
      eq(calendarInvites.sessionId, row.sessionId),
    ))
    .limit(1);
  const scheduled = record.status === "published" && Boolean(record.startsAt && record.endsAt && record.speakerContactId);
  const method = scheduled ? "REQUEST" : existing ? "CANCEL" : null;
  if (!method) return null;

  const currentOrganizer = senderAddress(env);
  const uid = icsUid(row.sessionId, row.contactId, senderDomain(currentOrganizer));
  let state: { sequence: number; icsUid: string; organizerEmail: string } | undefined;
  if (method === "CANCEL" && existing?.lastMethod === "cancel") {
    state = existing;
  } else {
    [state] = await dbOrTx.insert(calendarInvites).values({
      eventId: row.eventId,
      contactId: row.contactId,
      sessionId: row.sessionId,
      icsUid: uid,
      sequence: record.scheduleRevision,
      lastMethod: method.toLowerCase() as "request" | "cancel",
      organizerEmail: currentOrganizer,
      lastSentAt: sql`now()`,
    }).onConflictDoUpdate({
      target: [calendarInvites.contactId, calendarInvites.sessionId],
      set: {
        sequence: sql`GREATEST(${calendarInvites.sequence}, excluded.sequence)
          + CASE WHEN excluded.last_method = 'cancel' AND ${calendarInvites.sequence} >= excluded.sequence THEN 1 ELSE 0 END`,
        lastMethod: sql`excluded.last_method`,
        lastSentAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    }).returning();
  }
  if (!state) return null;
  if (state.organizerEmail !== currentOrganizer) {
    log({
      level: "warn",
      msg: "calendar.organizer_change_ignored",
      requestId: row.id,
      feature: "comms",
      eventId: row.eventId,
      code: state.organizerEmail,
    });
  }

  let downloadUrl = options.downloadUrl;
  if (!downloadUrl) {
    const token = await issuePortalToken(dbOrTx, {
      contactId: contactIdSchema.parse(row.contactId),
      eventId: eventIdSchema.parse(row.eventId),
      purpose: "ics_download",
      ttl: "P365D",
    });
    downloadUrl = `${env.APP_BASE_URL}/cal/${encodeURIComponent(token.raw)}/${encodeURIComponent(row.sessionId)}`;
  }

  const startsAt = record.startsAt ?? record.eventStartsAt;
  const endsAt = record.endsAt ?? record.eventEndsAt;
  const portalUrl = `${env.APP_BASE_URL}/portal/${encodeURIComponent(record.eventSlug)}`;
  const description = [stripHtml(record.descriptionHtml ?? ""), portalUrl].filter(Boolean).join("\n\n");
  const event: IcsEvent = {
    uid: state.icsUid,
    sequence: state.sequence,
    method,
    startsAt,
    endsAt,
    dtstamp: options.now ?? new Date(),
    summary: record.title,
    description,
    location: [record.room, record.eventLocation].filter(Boolean).join(" · "),
    url: `${env.APP_BASE_URL}/e/${encodeURIComponent(record.eventSlug)}/schedule?session=${encodeURIComponent(row.sessionId)}`,
    organizer: { name: record.eventName, email: state.organizerEmail },
    attendee: {
      name: `${record.attendeeFirstName} ${record.attendeeLastName}`.trim() || record.attendeeEmail,
      email: record.attendeeEmail,
    },
    cancelled: method === "CANCEL",
  };
  return {
    ics: buildInvite(event),
    filename: "invite.ics",
    contentType: `text/calendar; charset=utf-8; method=${method}`,
    uid: state.icsUid,
    sequence: state.sequence,
    method,
    attendeeEmail: record.attendeeEmail,
    googleUrl: googleCalendarUrl(event),
    outlookUrl: outlookCalendarUrl(event),
    downloadUrl,
  };
}

export async function prepareInvite(row: InviteRow): Promise<PreparedInvite | null> {
  return prepareInviteIn(db, row, getEnv());
}

export type CalendarTokenIdentity = { contactId: string; eventId: string };

async function calendarIdentity(dbOrTx: DbOrTx, identity: CalendarTokenIdentity) {
  const [record] = await dbOrTx.select({
    eventName: events.name,
    eventSlug: events.slug,
    eventLocation: events.location,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    email: contacts.email,
  }).from(events)
    .innerJoin(contacts, and(eq(contacts.eventId, events.id), eq(contacts.id, identity.contactId)))
    .where(eq(events.id, identity.eventId))
    .limit(1);
  return record ?? null;
}

async function calendarSessions(dbOrTx: DbOrTx, identity: CalendarTokenIdentity, sessionId?: string) {
  const filters: SQL[] = [
    eq(sessions.eventId, identity.eventId),
    eq(sessions.status, "published"),
    isNotNull(sessions.startsAt),
    isNotNull(sessions.endsAt),
    ...(sessionId ? [eq(sessions.id, sessionId)] : []),
  ];
  return dbOrTx.select({
    id: sessions.id,
    title: sessions.title,
    descriptionHtml: sessions.descriptionHtml,
    startsAt: sessions.startsAt,
    endsAt: sessions.endsAt,
    updatedAt: sessions.updatedAt,
    scheduleRevision: sessions.scheduleRevision,
    room: rooms.name,
    inviteUid: calendarInvites.icsUid,
    inviteSequence: calendarInvites.sequence,
    organizerEmail: calendarInvites.organizerEmail,
  }).from(sessions)
    .innerJoin(sessionSpeakers, and(
      eq(sessionSpeakers.eventId, sessions.eventId),
      eq(sessionSpeakers.sessionId, sessions.id),
      eq(sessionSpeakers.contactId, identity.contactId),
    ))
    .leftJoin(rooms, and(eq(rooms.id, sessions.roomId), eq(rooms.eventId, sessions.eventId)))
    .leftJoin(calendarInvites, and(
      eq(calendarInvites.eventId, sessions.eventId),
      eq(calendarInvites.sessionId, sessions.id),
      eq(calendarInvites.contactId, identity.contactId),
    ))
    .where(and(...filters))
    .orderBy(asc(sessions.startsAt), asc(sessions.id));
}

type CalendarSession = Awaited<ReturnType<typeof calendarSessions>>[number];
type IdentityRecord = NonNullable<Awaited<ReturnType<typeof calendarIdentity>>>;

function feedEvent(
  session: CalendarSession,
  identity: CalendarTokenIdentity,
  event: IdentityRecord,
  env: RuntimeEnv,
): IcsEvent | null {
  if (!session.startsAt || !session.endsAt) return null;
  const organizerEmail = session.organizerEmail ?? senderAddress(env);
  const portalUrl = `${env.APP_BASE_URL}/portal/${encodeURIComponent(event.eventSlug)}`;
  return {
    uid: session.inviteUid ?? icsUid(session.id, identity.contactId, senderDomain(organizerEmail)),
    sequence: session.inviteSequence ?? session.scheduleRevision,
    method: null,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    dtstamp: session.updatedAt,
    summary: session.title,
    description: [stripHtml(session.descriptionHtml ?? ""), portalUrl].filter(Boolean).join("\n\n"),
    location: [session.room, event.eventLocation].filter(Boolean).join(" · "),
    url: `${env.APP_BASE_URL}/e/${encodeURIComponent(event.eventSlug)}/schedule?session=${encodeURIComponent(session.id)}`,
    organizer: { name: event.eventName, email: organizerEmail },
  };
}

export async function buildCalendarFeedIn(
  dbOrTx: DbOrTx,
  identity: CalendarTokenIdentity,
  env: RuntimeEnv,
): Promise<string | null> {
  const event = await calendarIdentity(dbOrTx, identity);
  if (!event) return null;
  const sessionsForSpeaker = await calendarSessions(dbOrTx, identity);
  const calendarEvents = sessionsForSpeaker
    .map((session) => feedEvent(session, identity, event, env))
    .filter((session): session is IcsEvent => session !== null);
  const speakerName = `${event.firstName} ${event.lastName}`.trim() || event.email;
  return buildFeed(`${event.eventName} — ${speakerName}`, calendarEvents);
}

export async function buildCalendarDownloadIn(
  dbOrTx: DbOrTx,
  identity: CalendarTokenIdentity,
  sessionId: string,
  env: RuntimeEnv,
): Promise<string | null> {
  const event = await calendarIdentity(dbOrTx, identity);
  if (!event) return null;
  const [session] = await calendarSessions(dbOrTx, identity, sessionId);
  if (!session) return null;
  const calendarEvent = feedEvent(session, identity, event, env);
  return calendarEvent ? buildInvite(calendarEvent) : null;
}
