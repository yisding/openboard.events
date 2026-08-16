import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { listSpeakerOptionsIn, type SpeakerOptionRow } from "@/features/portal";
import {
  mySessionDtoSchema,
  roomDtoSchema,
  scheduledSessionDtoSchema,
  sessionContentRevisionDtoSchema,
  sessionFormatDtoSchema,
  sessionPlacementRevisionDtoSchema,
  trackDtoSchema,
  type ContactId,
  type EventId,
  type MySessionDTO,
  type RoomDTO,
  type ScheduledSessionDTO,
  type SessionContentRevisionDTO,
  type SessionFormatDTO,
  type SessionId,
  type SessionPlacementRevisionDTO,
  type SessionStatus,
  type SubmissionStatus,
  type TrackDTO,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { endOfDayInTz, startOfDayInTz } from "@/shared/lib/time";
import { toScheduledSession, type ScheduledSession } from "../conflicts";

/**
 * Every read the agenda makes. Three rules hold across all of them:
 *
 * 1. `eventId` is the first parameter and appears in every WHERE clause. The
 *    composite foreign keys make a cross-event join a constraint violation, but
 *    a missing predicate is still a leak, so the predicate is written anyway.
 * 2. Sessions with NULL times are *returned*, not filtered — the List view and
 *    the tray exist to show them. Only `getSchedulableSessions` drops them, and
 *    it does so structurally through `toScheduledSession`.
 * 3. Day filtering converts the day key to a `[startUtc, endUtc)` window in the
 *    **event's** zone. `DATE(starts_at)` in raw UTC bins a 9pm PT session onto
 *    the following day.
 */

export type SessionFilters = {
  search?: string;
  trackId?: string | null;
  roomId?: string | null;
  status?: SessionStatus | "all";
  /** An event-zone day key, `YYYY-MM-DD`. */
  day?: string | null;
};

/**
 * The lookup lists the dialog and the views need to render ids as names.
 *
 * `SpeakerOption` is portal's `SpeakerOptionRow` under the agenda's own name —
 * an alias, not a copy, so the session dialog's picker and the Add abstract
 * drawer's picker are typed by the same row.
 */
export type SpeakerOption = SpeakerOptionRow;
export type AgendaVocabulary = {
  rooms: RoomDTO[];
  tracks: TrackDTO[];
  formats: SessionFormatDTO[];
  speakers: SpeakerOption[];
};

type SessionRow = {
  id: string;
  title: string;
  slug: string;
  description_html: string | null;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  track_id: string | null;
  room_id: string | null;
  format_id: string | null;
  status: SessionStatus;
  schedule_revision: number;
  row_version: number;
  speaker_ids: string[] | null;
  submission_id: string | null;
  submission_code: number | null;
  submission_title: string | null;
  submission_status: SubmissionStatus | null;
  expected_attendance: number | string | null;
};

/** Postgres hands timestamptz back as a string here and a Date there. */
function iso(value: string | Date | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/**
 * `sub` is the abstract this session was promoted from, joined on every read so
 * the admin can see what the public firewall already acts on: a promoted
 * session leaves `published_sessions_v` the moment its abstract stops being
 * `accepted`, and an abstract title edit never reaches the session row.
 *
 * MTP-07 takes a fourth column off that same `sub` row: the audience size the
 * abstract declared, which the capacity advisory weighs against the room. It
 * is a plain `sub.capacity` and not a correlated subquery precisely because
 * the join is already here — re-reading a row the query has already joined is
 * a second lookup for nothing. `SESSION_COLUMNS` is therefore only ever
 * selected `FROM ${SESSION_SOURCE}`; the two are one unit.
 */
const SESSION_COLUMNS = sql`
  s.id, s.title, s.slug, s.description_html, s.starts_at, s.ends_at,
  s.track_id, s.room_id, s.format_id, s.status, s.schedule_revision, s.row_version,
  s.submission_id, sub.code AS submission_code, sub.title AS submission_title, sub.status AS submission_status,
  sub.capacity AS expected_attendance,
  (
    SELECT coalesce(array_agg(ss.contact_id ORDER BY ss.sort_order, ss.contact_id), '{}')
    FROM session_speakers ss
    WHERE ss.session_id = s.id AND ss.event_id = s.event_id
  ) AS speaker_ids
`;

// LEFT, so a session authored straight in the agenda keeps its row and simply
// reports a null abstract and a null expected attendance rather than vanishing.
const SESSION_SOURCE = sql`
  sessions s
  LEFT JOIN submissions sub ON sub.id = s.submission_id AND sub.event_id = s.event_id
`;

function toDto(row: SessionRow): ScheduledSessionDTO {
  return scheduledSessionDtoSchema.parse({
    id: row.id,
    title: row.title,
    slug: row.slug,
    descriptionHtml: row.description_html ?? "",
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    trackId: row.track_id,
    roomId: row.room_id,
    formatId: row.format_id,
    status: row.status,
    scheduleRevision: Number(row.schedule_revision),
    rowVersion: Number(row.row_version),
    speakerIds: row.speaker_ids ?? [],
    linkedSubmission: row.submission_id === null || row.submission_status === null ? null : {
      id: row.submission_id,
      code: Number(row.submission_code ?? 0),
      title: row.submission_title ?? "",
      status: row.submission_status,
    },
    expectedAttendance: typeof row.expected_attendance === "number" || typeof row.expected_attendance === "string"
      ? Number(row.expected_attendance)
      : null,
  });
}

/** The event's zone, cached per call chain by the caller passing `day`. */
async function eventTimezone(dbOrTx: DbOrTx, eventId: EventId): Promise<string> {
  const result = await dbOrTx.execute<{ timezone: string }>(sql`
    SELECT timezone FROM events WHERE id = ${eventId}
  `);
  const timezone = (result.rows ?? [])[0]?.timezone;
  if (!timezone) throw new AppError("NOT_FOUND", "Event not found");
  return timezone;
}

async function dayBounds(dbOrTx: DbOrTx, eventId: EventId, day: string): Promise<{ from: Date; to: Date }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError("VALIDATION", "day must be a YYYY-MM-DD event day key");
  const timezone = await eventTimezone(dbOrTx, eventId);
  // `startOfDayInTz`, not `T00:00:00`: in a zone whose clock jumps forward at
  // midnight that wall time does not exist, and `zonedInputToUtc` resolves it
  // backwards into the previous day — so the window became 25 hours and a
  // session late on the 7th satisfied both the 7th's and the 8th's filter,
  // rendering on two day tabs and drawing at a negative offset on one of them.
  return { from: startOfDayInTz(day, timezone), to: endOfDayInTz(day, timezone) };
}

async function whereClause(dbOrTx: DbOrTx, eventId: EventId, filters: SessionFilters) {
  const clauses = [sql`s.event_id = ${eventId}`];
  if (filters.search?.trim()) {
    clauses.push(sql`lower(s.title) LIKE ${`%${filters.search.trim().toLowerCase()}%`}`);
  }
  if (filters.trackId) clauses.push(sql`s.track_id = ${filters.trackId}`);
  if (filters.roomId) clauses.push(sql`s.room_id = ${filters.roomId}`);
  if (filters.status && filters.status !== "all") clauses.push(sql`s.status = ${filters.status}`);
  if (filters.day) {
    const { from, to } = await dayBounds(dbOrTx, eventId, filters.day);
    // Half-open on the left, inclusive at 23:59:59.999 on the right — the same
    // window `endOfDayInTz` defines for every other deadline in the product.
    clauses.push(sql`s.starts_at >= ${from.toISOString()} AND s.starts_at <= ${to.toISOString()}`);
  }
  return sql.join(clauses, sql` AND `);
}

export async function listSessionsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  filters: SessionFilters = {},
): Promise<ScheduledSessionDTO[]> {
  const where = await whereClause(dbOrTx, eventId, filters);
  const result = await dbOrTx.execute<SessionRow>(sql`
    SELECT ${SESSION_COLUMNS} FROM ${SESSION_SOURCE}
    WHERE ${where}
    ORDER BY s.starts_at ASC NULLS LAST, lower(s.title) ASC, s.id ASC
  `);
  return (result.rows ?? []).map(toDto);
}

export const listSessions = (eventId: EventId, filters?: SessionFilters) =>
  listSessionsIn(db, eventId, filters);

/**
 * The normalized epoch-ms shape the conflict engine and the day grid consume.
 * `toScheduledSession` returns `null` for a NULL-time row, so unscheduled
 * sessions are excluded by construction rather than by a filter somebody can
 * forget to write.
 */
export async function getSchedulableSessionsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  day?: string | null,
): Promise<ScheduledSession[]> {
  const rows = await listSessionsIn(dbOrTx, eventId, day ? { day } : {});
  return rows.flatMap((row) => {
    const normalized = toScheduledSession(row);
    return normalized ? [normalized] : [];
  });
}

export const getSchedulableSessions = (eventId: EventId, day?: string | null) =>
  getSchedulableSessionsIn(db, eventId, day);

export async function getSessionIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  sessionId: SessionId,
): Promise<ScheduledSessionDTO | null> {
  const result = await dbOrTx.execute<SessionRow>(sql`
    SELECT ${SESSION_COLUMNS} FROM ${SESSION_SOURCE} WHERE s.id = ${sessionId} AND s.event_id = ${eventId}
  `);
  const row = (result.rows ?? [])[0];
  return row ? toDto(row) : null;
}

export const getSession = (eventId: EventId, sessionId: SessionId) => getSessionIn(db, eventId, sessionId);

/**
 * The portal's My Sessions card. `contactId` is a required argument, never
 * inferred from the row — a portal read that derives its own subject is one
 * refactor away from being an IDOR.
 */
export async function getMySessionsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
): Promise<MySessionDTO[]> {
  const result = await dbOrTx.execute<{
    id: string; title: string; starts_at: string | Date | null; ends_at: string | Date | null;
    room_name: string | null; track_name: string | null;
  }>(sql`
    SELECT s.id, s.title, s.starts_at, s.ends_at, s.room_name, s.track_name
    FROM session_speakers ss
    JOIN published_sessions_v s ON s.id = ss.session_id AND s.event_id = ss.event_id
    WHERE ss.event_id = ${eventId} AND ss.contact_id = ${contactId}
    ORDER BY s.starts_at ASC, s.id ASC
  `);
  return (result.rows ?? []).map((row) => mySessionDtoSchema.parse({
    sessionId: row.id,
    title: row.title,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    roomName: row.room_name,
    trackName: row.track_name,
  }));
}

export const getMySessions = (eventId: EventId, contactId: ContactId) => getMySessionsIn(db, eventId, contactId);

/**
 * M52 — a session's attributed title/description history, newest first. Every
 * row `saveSessionIn` and `restoreSessionContentIn` write, never edited or
 * deleted — the history panel's whole point is that nothing here can quietly
 * change out from under it.
 */
export async function listSessionContentRevisionsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  sessionId: SessionId,
): Promise<SessionContentRevisionDTO[]> {
  const result = await dbOrTx.execute<{
    id: string; title: string; description_html: string; edited_by_name: string | null;
    restored_from_revision_id: string | null; created_at: string;
  }>(sql`
    SELECT r.id, r.title, r.description_html, r.restored_from_revision_id, r.created_at,
           coalesce(nullif(btrim(u.name), ''), u.email) AS edited_by_name
    FROM session_content_revisions r
    LEFT JOIN users u ON u.id = r.edited_by_user_id
    WHERE r.event_id = ${eventId} AND r.session_id = ${sessionId}
    ORDER BY r.created_at DESC, r.id DESC
  `);
  return (result.rows ?? []).map((row) => sessionContentRevisionDtoSchema.parse({
    id: row.id,
    sessionId,
    title: row.title,
    descriptionHtml: row.description_html,
    editedByName: row.edited_by_name,
    restoredFromRevisionId: row.restored_from_revision_id,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export const listSessionContentRevisions = (eventId: EventId, sessionId: SessionId) =>
  listSessionContentRevisionsIn(db, eventId, sessionId);

/**
 * MTP-07 — the same session's *placement* history, newest first: every recorded
 * move, whoever made it and however they made it (grid drag, dialog, Auto-place
 * apply — they all commit through the two writers in `mutations.ts`).
 *
 * Room names come straight off the recorded row, never a join back to `rooms`:
 * the point of freezing them at write time is that a since-renamed or deleted
 * room cannot rewrite what this session's schedule used to say.
 */
export async function listSessionPlacementRevisionsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  sessionId: SessionId,
): Promise<SessionPlacementRevisionDTO[]> {
  const result = await dbOrTx.execute<{
    id: string;
    from_starts_at: string | Date | null; from_ends_at: string | Date | null; from_room_name: string | null;
    to_starts_at: string | Date | null; to_ends_at: string | Date | null; to_room_name: string | null;
    moved_by_name: string | null; created_at: string | Date;
  }>(sql`
    SELECT p.id, p.from_starts_at, p.from_ends_at, p.from_room_name,
           p.to_starts_at, p.to_ends_at, p.to_room_name, p.created_at,
           coalesce(nullif(btrim(u.name), ''), u.email) AS moved_by_name
    FROM session_placement_revisions p
    LEFT JOIN users u ON u.id = p.moved_by_user_id
    WHERE p.event_id = ${eventId} AND p.session_id = ${sessionId}
    ORDER BY p.created_at DESC, p.id DESC
  `);
  return (result.rows ?? []).map((row) => sessionPlacementRevisionDtoSchema.parse({
    id: row.id,
    sessionId,
    from: { startsAt: iso(row.from_starts_at), endsAt: iso(row.from_ends_at), roomName: row.from_room_name },
    to: { startsAt: iso(row.to_starts_at), endsAt: iso(row.to_ends_at), roomName: row.to_room_name },
    movedByName: row.moved_by_name,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export const listSessionPlacementRevisions = (eventId: EventId, sessionId: SessionId) =>
  listSessionPlacementRevisionsIn(db, eventId, sessionId);

/**
 * Rooms, tracks, formats and the event's contacts, in one round trip.
 *
 * M11 owns the vocabulary CRUD; these reads are deliberately plain SELECTs over
 * the same tables rather than a fixture, so the dialog's dropdowns show what the
 * organizer actually created. When `@/features/events` exports `listTracks`/
 * `listRooms`/`listFormats`, this becomes three delegating calls.
 */
export async function listAgendaVocabularyIn(dbOrTx: DbOrTx, eventId: EventId): Promise<AgendaVocabulary> {
  const [roomRows, trackRows, formatRows, speakerRows] = await Promise.all([
    dbOrTx.execute<{ id: string; name: string; capacity: number | null; sort_order: number }>(sql`
      SELECT id, name, capacity, sort_order FROM rooms WHERE event_id = ${eventId} ORDER BY sort_order, name
    `),
    dbOrTx.execute<{ id: string; name: string; color: string; description: string | null; sort_order: number }>(sql`
      SELECT id, name, color, description, sort_order FROM tracks WHERE event_id = ${eventId} ORDER BY sort_order, name
    `),
    dbOrTx.execute<{ id: string; name: string; default_duration_mins: number; sort_order: number }>(sql`
      SELECT id, name, default_duration_mins, sort_order FROM session_formats WHERE event_id = ${eventId} ORDER BY sort_order, name
    `),
    // Shared with the Add abstract drawer's speaker picker, so the two surfaces
    // that attach a person to a talk always offer the same list of people.
    listSpeakerOptionsIn(dbOrTx, eventId),
  ]);
  return {
    rooms: (roomRows.rows ?? []).map((row) => roomDtoSchema.parse({
      id: row.id, name: row.name, capacity: row.capacity === null ? null : Number(row.capacity), sortOrder: Number(row.sort_order),
    })),
    tracks: (trackRows.rows ?? []).map((row) => trackDtoSchema.parse({
      id: row.id, name: row.name, color: row.color, description: row.description, sortOrder: Number(row.sort_order),
    })),
    formats: (formatRows.rows ?? []).map((row) => sessionFormatDtoSchema.parse({
      id: row.id, name: row.name, defaultDurationMins: Number(row.default_duration_mins), sortOrder: Number(row.sort_order),
    })),
    speakers: speakerRows,
  };
}

export const listAgendaVocabulary = (eventId: EventId) => listAgendaVocabularyIn(db, eventId);

/**
 * The promotion picker's source is M18's `getAcceptedForScheduling(eventId)`,
 * imported from `@/features/submissions` by the page that renders the tray.
 * It is not re-implemented here: `submissions` owns every read of its own
 * table, and `alreadyPromoted` is the one field the tray filters on.
 */
