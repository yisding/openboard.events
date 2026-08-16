import { and, asc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { calendarInvites, contacts, events, rooms, sessions, sessionSpeakers, tracks } from "@/db/schema";
import { issuePortalToken } from "@/features/auth";
import { buildFeed, buildInvite, googleCalendarUrl, icsUid, outlookCalendarUrl, type IcsEvent } from "@/features/comms/ics";
import { contactIdSchema, eventIdSchema, sessionIdSchema } from "@/shared/contracts";
import { emailFromAddress, getEnv, type RuntimeEnv } from "@/shared/lib/env";
import { log } from "@/shared/lib/log";
import {
  assertSnapshotIdentity,
  parseCalendarCancellationSnapshot,
  parseCalendarEventSnapshot,
  serializeCalendarEventSnapshot,
  type CalendarEventSnapshot,
} from "./calendar-snapshot";
import { stripHtml } from "./render";
import type { DeliveryOutboxRow } from "./context";

type InviteRow = DeliveryOutboxRow & { contactId: string };

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

type SnapshotState = { sequence: number; icsUid: string; organizerEmail: string };

/**
 * The METHOD-less, attendee-less event a snapshot describes — everything a
 * subscription feed may carry. `eventFromSnapshot` adds the METHOD and the
 * ATTENDEE an emailed REQUEST/CANCEL additionally requires.
 */
function feedEventFromSnapshot(
  snapshot: CalendarEventSnapshot,
  state: SnapshotState,
  env: RuntimeEnv,
  now: Date,
): IcsEvent {
  const portalUrl = `${env.APP_BASE_URL}/portal/${encodeURIComponent(snapshot.eventSlug)}`;
  return {
    uid: state.icsUid,
    sequence: state.sequence,
    method: null,
    startsAt: snapshot.startsAt,
    endsAt: snapshot.endsAt,
    dtstamp: now,
    summary: snapshot.title,
    description: [stripHtml(snapshot.descriptionHtml ?? ""), portalUrl].filter(Boolean).join("\n\n"),
    location: [snapshot.room, snapshot.eventLocation].filter(Boolean).join(" · "),
    url: `${env.APP_BASE_URL}/e/${encodeURIComponent(snapshot.eventSlug)}/schedule?session=${encodeURIComponent(snapshot.sessionId)}`,
    organizer: { name: snapshot.eventName, email: state.organizerEmail },
  };
}

function eventFromSnapshot(
  snapshot: CalendarEventSnapshot,
  state: SnapshotState,
  method: "REQUEST" | "CANCEL",
  env: RuntimeEnv,
  now: Date,
): IcsEvent {
  return {
    ...feedEventFromSnapshot(snapshot, state, env, now),
    method,
    attendee: {
      name: `${snapshot.attendeeFirstName} ${snapshot.attendeeLastName}`.trim() || snapshot.attendeeEmail,
      email: snapshot.attendeeEmail,
    },
    cancelled: method === "CANCEL",
  };
}

function preparedInvite(
  event: IcsEvent,
  method: "REQUEST" | "CANCEL",
  downloadUrl: string,
): PreparedInvite {
  return {
    ics: buildInvite(event),
    filename: "invite.ics",
    contentType: `text/calendar; charset=utf-8; method=${method}`,
    uid: event.uid,
    sequence: event.sequence,
    method,
    attendeeEmail: event.attendee?.email ?? "",
    googleUrl: method === "REQUEST" ? googleCalendarUrl(event) : "",
    outlookUrl: method === "REQUEST" ? outlookCalendarUrl(event) : "",
    downloadUrl,
  };
}

export async function prepareInviteIn(
  dbOrTx: DbOrTx,
  row: InviteRow,
  env: RuntimeEnv,
  options: PrepareOptions = {},
): Promise<PreparedInvite | null> {
  if (row.templateKey !== "schedule_assigned" && row.templateKey !== "schedule_changed") return null;

  const now = options.now ?? new Date();
  const rawCancellationSnapshot = row.calendarCancellationSnapshot ?? null;
  if (rawCancellationSnapshot !== null) {
    const cancellation = parseCalendarCancellationSnapshot(rawCancellationSnapshot);
    assertSnapshotIdentity(cancellation, row);
    const currentOrganizer = senderAddress(env);
    if (cancellation.organizerEmail !== currentOrganizer) {
      log({
        level: "warn",
        msg: "calendar.organizer_change_ignored",
        requestId: row.id,
        feature: "comms",
        eventId: row.eventId,
        code: cancellation.organizerEmail,
      });
    }
    const event = eventFromSnapshot(cancellation, {
      sequence: cancellation.sequence,
      icsUid: cancellation.uid,
      organizerEmail: cancellation.organizerEmail,
    }, "CANCEL", env, cancellation.cancelledAt);
    return preparedInvite(event, "CANCEL", "");
  }

  if (!row.sessionId) return null;

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
    eventTimezone: events.timezone,
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
    id: calendarInvites.id,
    lastMethod: calendarInvites.lastMethod,
    sequence: calendarInvites.sequence,
    icsUid: calendarInvites.icsUid,
    organizerEmail: calendarInvites.organizerEmail,
    eventSnapshot: calendarInvites.eventSnapshot,
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
  const currentSnapshot: CalendarEventSnapshot = {
    version: 1,
    eventId: eventIdSchema.parse(row.eventId),
    sessionId: sessionIdSchema.parse(row.sessionId),
    contactId: contactIdSchema.parse(row.contactId),
    title: record.title,
    descriptionHtml: record.descriptionHtml,
    startsAt: record.startsAt ?? record.eventStartsAt,
    endsAt: record.endsAt ?? record.eventEndsAt,
    room: record.room,
    track: record.track,
    eventName: record.eventName,
    eventSlug: record.eventSlug,
    eventLocation: record.eventLocation,
    eventTimezone: record.eventTimezone,
    attendeeEmail: record.attendeeEmail,
    attendeeFirstName: record.attendeeFirstName,
    attendeeLastName: record.attendeeLastName,
  };
  const nextSnapshot = method === "REQUEST"
    ? currentSnapshot
    : existing ? parseCalendarEventSnapshot(existing.eventSnapshot) : null;
  if (!nextSnapshot) return null;
  assertSnapshotIdentity(nextSnapshot, row);
  const storedSnapshot = serializeCalendarEventSnapshot(nextSnapshot);

  let state: { sequence: number; icsUid: string; organizerEmail: string; eventSnapshot: unknown } | undefined;
  if (method === "REQUEST") {
    [state] = await dbOrTx.insert(calendarInvites).values({
      eventId: row.eventId,
      contactId: row.contactId,
      sessionId: row.sessionId,
      icsUid: uid,
      sequence: record.scheduleRevision,
      lastMethod: "request",
      organizerEmail: currentOrganizer,
      eventSnapshot: storedSnapshot,
      lastSentAt: sql`now()`,
    }).onConflictDoUpdate({
      target: [calendarInvites.contactId, calendarInvites.sessionId],
      set: {
        sequence: sql`GREATEST(${calendarInvites.sequence}, excluded.sequence)`,
        lastMethod: sql`excluded.last_method`,
        eventSnapshot: sql`excluded.event_snapshot`,
        lastSentAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    }).returning();
  } else if (existing) {
    // Preparing the provider payload and persisting its exact retry intent are
    // one database statement. A failed CANCEL must remain a CANCEL even if the
    // live session is republished or the speaker is re-added before retry.
    const result = await dbOrTx.execute<{
      sequence: number; icsUid: string; organizerEmail: string; eventSnapshot: unknown;
    }>(sql`
      WITH state AS (
        UPDATE calendar_invites SET
          sequence = CASE
            WHEN last_method = 'cancel' THEN sequence
            ELSE greatest(sequence + 1, ${record.scheduleRevision})
          END,
          last_method = 'cancel',
          event_snapshot = ${JSON.stringify(storedSnapshot)}::jsonb,
          last_sent_at = now(),
          updated_at = now()
        WHERE id = ${existing.id}
          AND event_id = ${row.eventId}
          AND contact_id = ${row.contactId}
          AND session_id = ${row.sessionId}
        RETURNING sequence, ics_uid, organizer_email, event_snapshot
      ), job AS (
        INSERT INTO calendar_cancellation_jobs (communication_log_id, snapshot)
        SELECT ${row.id}, state.event_snapshot || jsonb_build_object(
          'uid', state.ics_uid,
          'sequence', state.sequence,
          'organizerEmail', state.organizer_email,
          'cancelledAt', ${now.toISOString()}::timestamptz
        )
        FROM state
        ON CONFLICT (communication_log_id) DO UPDATE SET snapshot = excluded.snapshot
      )
      SELECT sequence, ics_uid AS "icsUid", organizer_email AS "organizerEmail",
             event_snapshot AS "eventSnapshot"
      FROM state
    `);
    [state] = result.rows ?? [];
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

  let downloadUrl = method === "REQUEST" ? options.downloadUrl : "";
  if (method === "REQUEST" && !downloadUrl) {
    const token = await issuePortalToken(dbOrTx, {
      contactId: contactIdSchema.parse(row.contactId),
      eventId: eventIdSchema.parse(row.eventId),
      purpose: "ics_download",
      ttl: "P365D",
    });
    downloadUrl = `${env.APP_BASE_URL}/cal/${encodeURIComponent(token.raw)}/${encodeURIComponent(row.sessionId)}`;
  }

  const snapshot = parseCalendarEventSnapshot(state.eventSnapshot);
  const event = eventFromSnapshot(snapshot, state, method, env, now);
  return preparedInvite(event, method, downloadUrl ?? "");
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

/**
 * The tombstones a subscribed calendar needs: sessions this speaker was
 * previously invited to that are no longer in the live feed, because the
 * session was unpublished, unscheduled, or the speaker was taken off it.
 *
 * A subscription feed is fetched forever, and dropping a VEVENT from it is not
 * a reliable instruction to any of the major clients — they keep showing the
 * stale event. `STATUS:CANCELLED` under the same UID is, so the row has to
 * survive its session leaving the published set.
 *
 * `calendar_invites` is that survivor: one row per (contact, session) that ever
 * had an invite prepared, holding the `ics_uid` the live feed already publishes
 * and the `event_snapshot` frozen at the last REQUEST — so the tombstone keeps
 * the title, time and room the speaker's calendar is currently showing rather
 * than re-reading a session that may have changed or vanished underneath it.
 *
 * Boundary: a *hard-deleted* session takes its `calendar_invites` row with it
 * (`session_id` cascades), so that case is still covered only by the CANCEL
 * email `deleteSessionIn` queues, not by this feed.
 */
async function cancelledCalendarEntries(
  dbOrTx: DbOrTx,
  identity: CalendarTokenIdentity,
  liveSessionIds: ReadonlySet<string>,
  env: RuntimeEnv,
): Promise<IcsEvent[]> {
  const invited = await dbOrTx.select({
    sessionId: calendarInvites.sessionId,
    icsUid: calendarInvites.icsUid,
    sequence: calendarInvites.sequence,
    lastMethod: calendarInvites.lastMethod,
    organizerEmail: calendarInvites.organizerEmail,
    eventSnapshot: calendarInvites.eventSnapshot,
    updatedAt: calendarInvites.updatedAt,
  }).from(calendarInvites)
    .where(and(
      eq(calendarInvites.eventId, identity.eventId),
      eq(calendarInvites.contactId, identity.contactId),
    ))
    .orderBy(asc(calendarInvites.sessionId));

  return invited
    .filter((row) => !liveSessionIds.has(row.sessionId))
    .map((row) => {
      // A cancellation already dispatched owns its sequence; one this feed is
      // first to report has to step past the CONFIRMED copy the subscriber
      // holds, matching what `deleteSessionIn`'s CANCEL would have sent.
      const sequence = row.lastMethod === "cancel" ? row.sequence : row.sequence + 1;
      const snapshot = parseCalendarEventSnapshot(row.eventSnapshot);
      // DTSTAMP is the invite row's `updatedAt`, which can predate the CONFIRMED
      // copy the subscriber already holds. That's fine per RFC 5545: SEQUENCE,
      // not DTSTAMP, is the authoritative revision counter, and it always steps
      // forward here, so clients still treat the tombstone as the newer state.
      // The same PUBLISH-shaped event as its live neighbours — no METHOD, no
      // ATTENDEE — only cancelled.
      return {
        ...feedEventFromSnapshot(
          snapshot,
          { sequence, icsUid: row.icsUid, organizerEmail: row.organizerEmail },
          env,
          row.updatedAt,
        ),
        cancelled: true,
      };
    });
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
  const cancelled = await cancelledCalendarEntries(
    dbOrTx,
    identity,
    new Set(sessionsForSpeaker.map((session) => session.id)),
    env,
  );
  const speakerName = `${event.firstName} ${event.lastName}`.trim() || event.email;
  return buildFeed(`${event.eventName} — ${speakerName}`, [...calendarEvents, ...cancelled]);
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
