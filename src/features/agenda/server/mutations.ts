import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, withTx, type DbOrTx, type TxDb } from "@/db/client";
import {
  contactIdSchema,
  formatIdSchema,
  idem,
  MAX_BULK_AGENDA_PROMOTIONS,
  roomIdSchema,
  sessionIdSchema,
  sessionStatusSchema,
  trackIdSchema,
  type AgendaPromotionResultItem,
  type BulkAgendaPromotionResult,
  type ConflictDTO,
  type ContactId,
  type EventId,
  type ScheduledSessionDTO,
  type SessionId,
  type SessionStatus,
  type SubmissionId,
  type TemplateKey,
  type UserId,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { sanitize } from "@/shared/lib/sanitize";
import { slugify } from "@/shared/lib/slug";
import { eventDayKey } from "@/shared/lib/time";
import { enqueueEmail } from "@/shared/server/enqueue-email";
import { detectConflicts } from "../conflicts";
import { getSchedulableSessionsIn } from "./queries";

/**
 * Every agenda write.
 *
 * `moveSession` opens a transaction because a drag has to settle the row
 * version, schedule revision and speakers' outbox rows together.
 * `bulkSetPublished` does the same for the whole confirmed publication batch:
 * otherwise a later enqueue failure could publish every session while mailing
 * only the speakers reached before the failure. Everything else here is a
 * single data-modifying statement — a CTE where more than one table changes.
 * Only the email enqueue on `saveSession` sits outside that guarantee, and
 * losing it costs a notification, never an explicitly confirmed bulk action.
 */

export const saveSessionInputSchema = z.object({
  id: sessionIdSchema.optional(),
  /** Caller-owned identity for a retry-safe manual create. */
  creationId: sessionIdSchema.optional(),
  /** Required whenever `id` is present: an update without a version is a blind write. */
  expectedVersion: z.int().positive().optional(),
  title: z.string().trim().min(1).max(255),
  descriptionHtml: z.string().max(100_000).default(""),
  formatId: formatIdSchema.nullable().default(null),
  trackId: trackIdSchema.nullable().default(null),
  roomId: roomIdSchema.nullable().default(null),
  startsAt: z.iso.datetime().nullable().default(null),
  endsAt: z.iso.datetime().nullable().default(null),
  speakerContactIds: z.array(contactIdSchema).max(50).default([]),
  status: sessionStatusSchema.default("draft"),
}).superRefine((value, context) => {
  if (value.id !== undefined && value.creationId !== undefined) {
    context.addIssue({ code: "custom", path: ["creationId"], message: "creationId is only valid when creating" });
  }
  if (value.id !== undefined && value.expectedVersion === undefined) {
    context.addIssue({ code: "custom", path: ["expectedVersion"], message: "expectedVersion is required when updating" });
  }
  // Mirrors the two DB CHECKs. The database is the guarantee; this is the
  // message an organizer can act on.
  if ((value.startsAt === null) !== (value.endsAt === null)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "Set both a start and an end time, or leave the session unscheduled" });
  }
  if (value.startsAt !== null && value.endsAt !== null && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "The end time must be after the start time" });
  }
});

export type SaveSessionInput = z.infer<typeof saveSessionInputSchema>;

/** The collection POST is stricter than internal create callers and PATCH. */
export const createSessionInputSchema = z.intersection(
  saveSessionInputSchema,
  z.object({
    creationId: sessionIdSchema,
    id: z.never().optional(),
    expectedVersion: z.never().optional(),
  }),
);

export const moveSessionInputSchema = z.object({
  id: sessionIdSchema,
  version: z.int().positive(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  roomId: roomIdSchema.nullable(),
}).superRefine((value, context) => {
  if ((value.startsAt === null) !== (value.endsAt === null)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "Set both a start and an end time, or leave the session unscheduled" });
  }
  if (value.startsAt !== null && value.endsAt !== null && Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "The end time must be after the start time" });
  }
});

export type MoveSessionInput = z.infer<typeof moveSessionInputSchema>;

const STALE_MESSAGE = "Session changed since you loaded it — refresh and try again";

/**
 * `enqueueEmail` is typed against `TxDb` because most of its callers are audited
 * transactions. `saveSession`'s publish path is deliberately not one — the same
 * accommodation the reminder scan makes, and for the same reason: the outbox
 * insert is a single statement either way.
 */
function asOutboxWriter(dbOrTx: DbOrTx): TxDb {
  return dbOrTx as TxDb;
}

/** A bound `uuid[]`, built element by element so no id is ever pasted into SQL. */
function uuidArraySql(ids: readonly string[]): SQL {
  if (ids.length === 0) return sql`'{}'::uuid[]`;
  return sql`ARRAY[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]`;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return true;
  const cause = error instanceof Error ? error.cause : undefined;
  const causeCode = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  if (causeCode === "23505") return true;
  const message = error instanceof Error ? error.message : "";
  const causeMessage = cause instanceof Error ? cause.message : "";
  return /duplicate key value|unique constraint/i.test(`${message} ${causeMessage}`);
}

/** Deduped, order-preserving: the PK is `(session_id, contact_id)`, so a repeat in the array must not reach the database twice. */
function uniqueSpeakers(ids: readonly ContactId[]): ContactId[] {
  return [...new Set(ids)];
}

/** Exact, normalized POST identity without persisting the organizer's content. */
async function creationPayloadFingerprint(input: SaveSessionInput): Promise<string> {
  const material = JSON.stringify({
    title: input.title,
    descriptionHtml: input.descriptionHtml,
    formatId: input.formatId,
    trackId: input.trackId,
    roomId: input.roomId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    speakerContactIds: input.speakerContactIds,
    status: input.status,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

type SessionRowShape = {
  id: string; title: string; slug: string; description_html: string | null;
  starts_at: string | Date | null; ends_at: string | Date | null;
  track_id: string | null; room_id: string | null; format_id: string | null;
  status: SessionStatus; schedule_revision: number; row_version: number;
};

function iso(value: string | Date | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

const EVENT_BOUNDS_MESSAGE = "Session times must stay within the event start and end";

/**
 * The database serialization point shared by every session placement write.
 *
 * Updating the parent event row makes a concurrent bounds update and session
 * write contend on the same row. The bounds predicate is part of that UPDATE,
 * and every session INSERT/UPDATE below depends on its RETURNING row, so the
 * check and the placement mutation are one statement. `updated_at` is internal
 * coordination state (EventDTO does not expose it); advancing it lets
 * updateEventIn detect that a schedule write won after its initial read and
 * retry against a fresh snapshot without invalidating the public rowVersion.
 */
function serializeScheduleWriteSql(
  eventId: EventId,
  startsAt: string | null,
  endsAt: string | null,
): SQL {
  const fits = startsAt === null || endsAt === null
    ? sql`true`
    : sql`${startsAt}::timestamptz >= starts_at AND ${endsAt}::timestamptz <= ends_at`;
  return sql`
    UPDATE events
    SET updated_at = greatest(updated_at + interval '1 millisecond', clock_timestamp())
    WHERE id = ${eventId} AND ${fits}
    RETURNING id
  `;
}

async function assertWithinEventBounds(
  dbOrTx: DbOrTx,
  eventId: EventId,
  startsAt: string | null,
  endsAt: string | null,
): Promise<void> {
  if (startsAt === null || endsAt === null) return;
  const result = await dbOrTx.execute<{ starts_at: string | Date; ends_at: string | Date }>(sql`
    SELECT starts_at, ends_at FROM events WHERE id = ${eventId}
  `);
  const event = (result.rows ?? [])[0];
  if (!event) throw new AppError("NOT_FOUND", "Event not found");
  if (Date.parse(startsAt) < Date.parse(iso(event.starts_at) ?? "")
      || Date.parse(endsAt) > Date.parse(iso(event.ends_at) ?? "")) {
    throw new AppError("VALIDATION", EVENT_BOUNDS_MESSAGE);
  }
}

function toDto(row: SessionRowShape, speakerIds: readonly ContactId[]): ScheduledSessionDTO {
  return {
    id: row.id as SessionId,
    title: row.title,
    slug: row.slug,
    descriptionHtml: row.description_html ?? "",
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    trackId: row.track_id as ScheduledSessionDTO["trackId"],
    roomId: row.room_id as ScheduledSessionDTO["roomId"],
    formatId: row.format_id as ScheduledSessionDTO["formatId"],
    status: row.status,
    scheduleRevision: Number(row.schedule_revision),
    rowVersion: Number(row.row_version),
    speakerIds: [...speakerIds],
  };
}

/**
 * The outbox half of a schedule change — and only the outbox half.
 *
 * It does **not** bump `schedule_revision`; its callers already did, inside the
 * statement that changed the schedule. The revision is part of the idempotency
 * key (`{eventId}:sched:{sessionId}:{contactId}:{revision}`), so an enqueue
 * without a preceding bump reuses the previous send's key and `ON CONFLICT DO
 * NOTHING` swallows the mail in silence.
 *
 * Recipients are handed in, never re-read from `session_speakers`: the after-set
 * is already in the caller's hand, and a fresh read could pick up a concurrent
 * edit and mail somebody about a schedule this change never gave them.
 */
export async function notifySchedule(
  dbOrTx: DbOrTx,
  eventId: EventId,
  sessionId: SessionId,
  prior: { status: SessionStatus; startsAt: string | null; scheduleRevision: number },
  next: { status: SessionStatus; startsAt: string | null; scheduleRevision: number },
  recipients: readonly ContactId[],
): Promise<number> {
  if (next.status !== "published" || next.startsAt === null) return 0;
  if (next.scheduleRevision <= prior.scheduleRevision) return 0;
  // First time this session's time reached a speaker, versus a change to one
  // they already have on their calendar.
  const templateKey: TemplateKey = prior.startsAt === null || prior.status !== "published"
    ? "schedule_assigned"
    : "schedule_changed";
  for (const contactId of recipients) {
    await enqueueEmail(asOutboxWriter(dbOrTx), {
      eventId,
      templateKey,
      contactId,
      idempotencyKey: idem.scheduled(eventId, sessionId, contactId, next.scheduleRevision),
      refs: { sessionId },
    });
  }
  return recipients.length;
}

/**
 * The other half of "who needs telling": speakers this save *added* to a session
 * that is already published and already timed.
 *
 * `notifySchedule` above is gated on `schedule_revision` moving, and rightly so —
 * the revision is what [M35](../../../plan/modules/M35-ics-calendar-invites.md)
 * derives its ICS `SEQUENCE` from, so bumping it because the speaker list changed
 * would re-issue calendar updates to everyone for a schedule that did not move.
 * But a speaker added to a published, timed session has never been told anything
 * at all, and gating them on a revision bump means they never are.
 *
 * So they are notified here instead, at the *current* revision: their
 * `{event}:sched:{session}:{contact}:{revision}` key has no row yet — that is
 * exactly what "this person was not on this schedule" means — so `enqueueEmail`'s
 * `ON CONFLICT DO NOTHING` lets it through, while the speakers who were already
 * on the session get nothing, because for them nothing changed. And the template
 * is unconditionally `schedule_assigned`: it is this speaker's first notice, even
 * when the session's own history would read as a change.
 */
async function notifyAddedSpeakers(
  dbOrTx: DbOrTx,
  eventId: EventId,
  sessionId: SessionId,
  next: { status: SessionStatus; startsAt: string | null; scheduleRevision: number },
  added: readonly ContactId[],
): Promise<number> {
  if (next.status !== "published" || next.startsAt === null) return 0;
  for (const contactId of added) {
    await enqueueEmail(asOutboxWriter(dbOrTx), {
      eventId,
      templateKey: "schedule_assigned",
      contactId,
      idempotencyKey: idem.scheduled(eventId, sessionId, contactId, next.scheduleRevision),
      refs: { sessionId },
    });
  }
  return added.length;
}

const RETURNED_COLUMNS = sql`id, title, slug, description_html, starts_at, ends_at, track_id, room_id, format_id, status, schedule_revision, row_version`;

async function insertSession(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: SaveSessionInput & { creationId: SessionId },
  slug: string,
  descriptionHtml: string,
  speakers: readonly ContactId[],
  actorUserId: UserId | null,
  payloadFingerprint: string,
): Promise<SessionRowShape> {
  // A session created already published and already timed has a schedule its
  // speakers have never seen, so it starts at revision 1 — otherwise the
  // notify below reads "nothing changed" and nobody is told.
  const initialRevision = input.status === "published" && input.startsAt !== null ? 1 : 0;
  // One statement: the durable create receipt, row, speakers and first content
  // revision (M52) land together or not at all. `receipt` selects from the
  // event guard so an invalid event/bounds check cannot consume the id.
  const result = await dbOrTx.execute<SessionRowShape>(sql`
    WITH event_guard AS (${serializeScheduleWriteSql(eventId, input.startsAt, input.endsAt)}), receipt AS (
      INSERT INTO session_creation_receipts (creation_id, event_id, payload_fingerprint)
      SELECT ${input.creationId}, ${eventId}, ${payloadFingerprint}
      FROM event_guard
      RETURNING creation_id
    ), created AS (
      INSERT INTO sessions (id, event_id, title, slug, description_html, format_id, track_id, room_id, starts_at, ends_at, status, schedule_revision)
      SELECT ${input.creationId}, ${eventId}, ${input.title}, ${slug}, ${descriptionHtml}, ${input.formatId}, ${input.trackId}, ${input.roomId},
             ${input.startsAt}, ${input.endsAt}, ${input.status}, ${initialRevision}
      FROM receipt
      RETURNING *
    ), ins AS (
      INSERT INTO session_speakers (event_id, session_id, contact_id, role, sort_order)
      SELECT ${eventId}, created.id, x.contact_id, (CASE WHEN x.ord = 1 THEN 'speaker' ELSE 'co_speaker' END)::participant_role, (x.ord - 1)::int
      FROM created, unnest(${uuidArraySql(speakers)}) WITH ORDINALITY AS x(contact_id, ord)
      RETURNING contact_id
    ), revision_ins AS (
      INSERT INTO session_content_revisions (event_id, session_id, title, description_html, edited_by_user_id)
      SELECT ${eventId}, created.id, created.title, created.description_html, ${actorUserId}
      FROM created
    )
    SELECT ${RETURNED_COLUMNS} FROM created
  `);
  const row = (result.rows ?? [])[0];
  if (!row) {
    await assertWithinEventBounds(dbOrTx, eventId, input.startsAt, input.endsAt);
    throw new AppError("INTERNAL", "The session could not be created");
  }
  return row;
}

type CreatedSessionRow = SessionRowShape & {
  event_id: string;
  submission_id: string | null;
  speaker_ids: string[] | null;
};

const CREATION_REPLAY_CONFLICT = "This creation attempt was already used for different session details";
const CREATION_DELETED_CONFLICT = "This creation attempt already completed, but the session was later deleted";

/**
 * Return the canonical result of an earlier committed create, but only when
 * the caller is replaying the exact same event-scoped payload. The create id is
 * globally unique, so querying it without an event predicate is intentional:
 * an id already owned by another event is a conflict, never a successful
 * cross-event replay.
 */
async function recoverCreatedSession(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: SaveSessionInput & { creationId: SessionId },
  payloadFingerprint: string,
  descriptionHtml: string,
  speakers: readonly ContactId[],
): Promise<ScheduledSessionDTO | null> {
  const receiptResult = await dbOrTx.execute<{ event_id: string; payload_fingerprint: string }>(sql`
    SELECT event_id, payload_fingerprint
    FROM session_creation_receipts
    WHERE creation_id = ${input.creationId}
  `);
  const receipt = (receiptResult.rows ?? [])[0];
  if (!receipt) {
    // A session using this globally unique id without our durable receipt is a
    // legacy/collision row, never proof that this caller's attempt succeeded.
    const collision = await dbOrTx.execute<{ id: string }>(sql`
      SELECT id FROM sessions WHERE id = ${input.creationId}
    `);
    if ((collision.rows ?? []).length > 0) throw new AppError("CONFLICT", CREATION_REPLAY_CONFLICT);
    return null;
  }
  if (receipt.event_id !== eventId || receipt.payload_fingerprint !== payloadFingerprint) {
    throw new AppError("CONFLICT", CREATION_REPLAY_CONFLICT);
  }

  const result = await dbOrTx.execute<CreatedSessionRow>(sql`
    SELECT ${RETURNED_COLUMNS}, s.event_id, s.submission_id,
      (
        SELECT coalesce(array_agg(ss.contact_id ORDER BY ss.sort_order, ss.contact_id), '{}')
        FROM session_speakers ss
        WHERE ss.session_id = s.id AND ss.event_id = s.event_id
      ) AS speaker_ids
    FROM sessions s
    WHERE s.id = ${input.creationId}
  `);
  const row = (result.rows ?? [])[0];
  if (!row) throw new AppError("CONFLICT", CREATION_DELETED_CONFLICT);
  if (row.event_id !== eventId || row.submission_id !== null) {
    throw new AppError("CONFLICT", CREATION_REPLAY_CONFLICT);
  }

  const currentSpeakers = (row.speaker_ids ?? []) as ContactId[];
  const initialRevision = input.status === "published" && input.startsAt !== null ? 1 : 0;
  const stillOriginalCreate = row.title === input.title
    && (row.description_html ?? "") === descriptionHtml
    && row.format_id === input.formatId
    && row.track_id === input.trackId
    && row.room_id === input.roomId
    && iso(row.starts_at) === (input.startsAt === null ? null : new Date(input.startsAt).toISOString())
    && iso(row.ends_at) === (input.endsAt === null ? null : new Date(input.endsAt).toISOString())
    && row.status === input.status
    && Number(row.schedule_revision) === initialRevision
    && Number(row.row_version) === 1
    && JSON.stringify(currentSpeakers) === JSON.stringify(speakers);

  if (stillOriginalCreate) {
    // The graph insert is already committed if a response was lost. Re-running
    // only this repair is safe: the outbox key includes session, speaker and
    // schedule revision, and enqueueEmail uses ON CONFLICT DO NOTHING. If the
    // canonical session has since been edited, return it without replaying an
    // obsolete create notification.
    await notifySchedule(
      dbOrTx, eventId, row.id as SessionId,
      { status: "draft", startsAt: null, scheduleRevision: 0 },
      { status: row.status, startsAt: iso(row.starts_at), scheduleRevision: Number(row.schedule_revision) },
      currentSpeakers,
    );
  }
  return toDto(row, currentSpeakers);
}

/**
 * Create or update. Both branches are one statement; the update's is guarded by
 * `row_version`, which is what turns two organizers editing the same session
 * from a silent overwrite into a 409 the second one can see.
 */
export async function saveSessionIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  rawInput: unknown,
  actorUserId: UserId | null = null,
): Promise<ScheduledSessionDTO> {
  const input = saveSessionInputSchema.parse(rawInput);
  // Never trust the editor's output: resolution #2 puts `sanitize()` on every
  // write path, create and update alike.
  const descriptionHtml = sanitize(input.descriptionHtml);
  const speakers = uniqueSpeakers(input.speakerContactIds);

  if (input.id === undefined) {
    const createInput: SaveSessionInput & { creationId: SessionId } = {
      ...input,
      creationId: input.creationId ?? sessionIdSchema.parse(crypto.randomUUID()),
    };
    const payloadFingerprint = await creationPayloadFingerprint(createInput);
    if (input.creationId !== undefined) {
      const recovered = await recoverCreatedSession(
        dbOrTx,
        eventId,
        createInput,
        payloadFingerprint,
        descriptionHtml,
        speakers,
      );
      if (recovered) return recovered;
    }
    // Mutable current bounds apply only to a genuinely fresh create. An exact
    // replay is proof of an already committed operation and must be recovered
    // above even if the event was narrowed after that commit.
    await assertWithinEventBounds(dbOrTx, eventId, input.startsAt, input.endsAt);
    const base = slugify(input.title) || "session";
    // Retry on the constraint rather than pre-checking: a pre-check races, the
    // unique index does not. This is why `saveSession` runs on the autocommitting
    // `neon-http` handle and not inside a transaction — a failed INSERT would
    // abort an enclosing transaction and the retry would have nothing to run in.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      try {
        const row = await insertSession(
          dbOrTx,
          eventId,
          createInput,
          slug,
          descriptionHtml,
          speakers,
          actorUserId,
          payloadFingerprint,
        );
        await notifySchedule(
          dbOrTx, eventId, row.id as SessionId,
          { status: "draft", startsAt: null, scheduleRevision: 0 },
          { status: row.status, startsAt: iso(row.starts_at), scheduleRevision: Number(row.schedule_revision) },
          speakers,
        );
        return toDto(row, speakers);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        if (input.creationId !== undefined) {
          const recovered = await recoverCreatedSession(
            dbOrTx,
            eventId,
            createInput,
            payloadFingerprint,
            descriptionHtml,
            speakers,
          );
          if (recovered) return recovered;
        }
      }
    }
    throw new AppError("CONFLICT", "Could not find a free URL for that title — rename the session");
  }

  const sessionId = input.id;
  const expectedVersion = input.expectedVersion ?? 0;
  await assertWithinEventBounds(dbOrTx, eventId, input.startsAt, input.endsAt);

  // The prior speaker set comes back with the guard read, not from a second
  // round trip after the write: step 3 is explicit that recipients are the
  // before-set already in hand and the validated input set, never a fresh
  // `session_speakers` re-read that could pick up a concurrent edit.
  const before = await dbOrTx.execute<{
    status: SessionStatus; starts_at: string | Date | null; ends_at: string | Date | null;
    room_id: string | null; schedule_revision: number; row_version: number;
    title: string; description_html: string | null; speaker_ids: string[] | null;
  }>(sql`
    SELECT s.status, s.starts_at, s.ends_at, s.room_id, s.schedule_revision, s.row_version, s.title, s.description_html,
      (
        SELECT coalesce(array_agg(ss.contact_id), '{}')
        FROM session_speakers ss
        WHERE ss.session_id = s.id AND ss.event_id = s.event_id
      ) AS speaker_ids
    FROM sessions s
    WHERE s.id = ${sessionId} AND s.event_id = ${eventId}
  `);
  const prior = (before.rows ?? [])[0];
  if (!prior) throw new AppError("NOT_FOUND", "Session not found");
  const priorSpeakers = new Set(prior.speaker_ids ?? []);

  /*
   * The bump reads the *incoming* status, not the stored one. A draft with times
   * being published is exactly the case a `WHEN status = 'published'` test would
   * miss — the stored status is still 'draft' when the CASE is evaluated — and
   * missing it means the speakers never learn they are on the schedule.
   *
   * The speaker set changes in the same statement: rows for people no longer on
   * the session are deleted, the rest are upserted. Deleting everything and
   * re-inserting cannot work here — the two sub-statements share a snapshot and
   * a command id, so the re-insert would collide with rows the delete has not
   * yet made invisible.
   */
  const speakerArray = uuidArraySql(speakers);
  const result = await dbOrTx.execute<SessionRowShape>(sql`
    WITH event_guard AS (${serializeScheduleWriteSql(eventId, input.startsAt, input.endsAt)}), updated AS (
      UPDATE sessions SET
        title = ${input.title},
        description_html = ${descriptionHtml},
        format_id = ${input.formatId},
        track_id = ${input.trackId},
        room_id = ${input.roomId},
        starts_at = ${input.startsAt},
        ends_at = ${input.endsAt},
        status = ${input.status},
        row_version = row_version + 1,
        schedule_revision = schedule_revision + CASE
          WHEN ${input.status}::text = 'published'
           AND (status::text IS DISTINCT FROM 'published'
                OR starts_at IS DISTINCT FROM ${input.startsAt}::timestamptz
                OR ends_at IS DISTINCT FROM ${input.endsAt}::timestamptz
                OR room_id IS DISTINCT FROM ${input.roomId}::uuid
                OR (${input.startsAt}::timestamptz IS NOT NULL
                    AND (title IS DISTINCT FROM ${input.title}
                         OR description_html IS DISTINCT FROM ${descriptionHtml})))
          THEN 1 ELSE 0 END,
        updated_at = now()
      WHERE id = ${sessionId} AND event_id = ${eventId} AND row_version = ${expectedVersion}
        AND EXISTS (SELECT 1 FROM event_guard)
      RETURNING *
    ), del AS (
      DELETE FROM session_speakers ss USING updated u
      WHERE ss.session_id = u.id AND ss.event_id = ${eventId}
        AND NOT (ss.contact_id = ANY(${speakerArray}))
      RETURNING ss.contact_id
    ), ins AS (
      INSERT INTO session_speakers (event_id, session_id, contact_id, role, sort_order)
      SELECT ${eventId}, u.id, x.contact_id, (CASE WHEN x.ord = 1 THEN 'speaker' ELSE 'co_speaker' END)::participant_role, (x.ord - 1)::int
      FROM updated u, unnest(${speakerArray}) WITH ORDINALITY AS x(contact_id, ord)
      ON CONFLICT (session_id, contact_id) DO UPDATE SET role = EXCLUDED.role, sort_order = EXCLUDED.sort_order
      RETURNING contact_id
    ), revision_ins AS (
      -- M52: a revision lands only when the update actually happened (a
      -- version conflict leaves the updated CTE empty) and only when title or
      -- description actually changed — a schedule-only save (drag, room
      -- swap) must not spam the history panel with identical content.
      INSERT INTO session_content_revisions (event_id, session_id, title, description_html, edited_by_user_id)
      SELECT ${eventId}, updated.id, updated.title, updated.description_html, ${actorUserId}
      FROM updated
      WHERE updated.title IS DISTINCT FROM ${prior.title}
         OR updated.description_html IS DISTINCT FROM ${prior.description_html}
    )
    SELECT ${RETURNED_COLUMNS} FROM updated
  `);
  const row = (result.rows ?? [])[0];
  if (!row) {
    const current = await dbOrTx.execute<{ row_version: number }>(sql`
      SELECT row_version FROM sessions WHERE id = ${sessionId} AND event_id = ${eventId}
    `);
    const latest = (current.rows ?? [])[0];
    if (!latest) throw new AppError("NOT_FOUND", "Session not found");
    if (Number(latest.row_version) !== expectedVersion) {
      throw new AppError("STALE_WRITE", STALE_MESSAGE, { expectedVersion, actualVersion: Number(latest.row_version) });
    }
    await assertWithinEventBounds(dbOrTx, eventId, input.startsAt, input.endsAt);
    throw new AppError("STALE_WRITE", STALE_MESSAGE, { expectedVersion, actualVersion: Number(prior.row_version) });
  }

  // Best effort, and explicitly outside the atomic statement above: a crash here
  // loses an email, not the schedule.
  //
  // Two disjoint sets, so nobody is mailed twice for one save: the speakers who
  // were already on the session hear about it only when the schedule itself
  // moved, and the ones this save added hear about it because it is their first
  // notice either way.
  const nextState = {
    status: row.status,
    startsAt: iso(row.starts_at),
    scheduleRevision: Number(row.schedule_revision),
  };
  const continuing = speakers.filter((contactId) => priorSpeakers.has(contactId));
  const added = speakers.filter((contactId) => !priorSpeakers.has(contactId));
  // Public feeds also advance their sequence for title/description changes,
  // but the speaker-email policy remains schedule-only. Preserve that policy
  // by calling the notifier only for the status/placement changes it already
  // handled before public feeds began consuming the same revision.
  const scheduleNoticeChanged = input.status === "published" && (
    prior.status !== "published"
    || iso(prior.starts_at) !== (input.startsAt === null ? null : new Date(input.startsAt).toISOString())
    || iso(prior.ends_at) !== (input.endsAt === null ? null : new Date(input.endsAt).toISOString())
    || prior.room_id !== input.roomId
  );
  if (scheduleNoticeChanged) {
    await notifySchedule(
      dbOrTx, eventId, sessionId,
      { status: prior.status, startsAt: iso(prior.starts_at), scheduleRevision: Number(prior.schedule_revision) },
      nextState,
      continuing,
    );
  }
  await notifyAddedSpeakers(dbOrTx, eventId, sessionId, nextState, added);
  return toDto(row, speakers);
}

export const saveSession = (eventId: EventId, input: unknown, actorUserId: UserId | null = null) =>
  saveSessionIn(db, eventId, input, actorUserId);

/**
 * M52 — restore an earlier revision as the session's current content. One
 * statement/CTE on the plain `neon-http` handle (the module's own guardrail:
 * do not add a ninth `withTx` path for this): the source revision is read,
 * a **new** revision recording the restore is inserted, and the session's
 * title/description are updated together, so a crash between them is
 * impossible rather than merely unlikely. Publication status is untouched —
 * restoring content is never itself a publish, matching the module's
 * "preserve draft/published as the public approval gate" guardrail.
 */
export async function restoreSessionContentIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  sessionId: SessionId,
  revisionId: string,
  actorUserId: UserId | null,
): Promise<ScheduledSessionDTO> {
  const result = await dbOrTx.execute<SessionRowShape>(sql`
    WITH source AS (
      SELECT title, description_html FROM session_content_revisions
      WHERE id = ${revisionId} AND event_id = ${eventId} AND session_id = ${sessionId}
    ), new_revision AS (
      INSERT INTO session_content_revisions (event_id, session_id, title, description_html, edited_by_user_id, restored_from_revision_id)
      SELECT ${eventId}, ${sessionId}, source.title, source.description_html, ${actorUserId}, ${revisionId}
      FROM source
      RETURNING title, description_html
    ), updated AS (
      UPDATE sessions SET
        title = new_revision.title,
        description_html = new_revision.description_html,
        row_version = sessions.row_version + 1,
        schedule_revision = sessions.schedule_revision + CASE
          WHEN sessions.status::text = 'published' AND sessions.starts_at IS NOT NULL
           AND (sessions.title IS DISTINCT FROM new_revision.title
                OR sessions.description_html IS DISTINCT FROM new_revision.description_html)
          THEN 1 ELSE 0 END,
        updated_at = now()
      FROM new_revision
      WHERE sessions.id = ${sessionId} AND sessions.event_id = ${eventId}
      RETURNING sessions.*
    )
    SELECT ${RETURNED_COLUMNS} FROM updated
  `);
  const row = (result.rows ?? [])[0];
  if (!row) throw new AppError("NOT_FOUND", "That revision could not be found");

  const speakerRows = await dbOrTx.execute<{ contact_id: string }>(sql`
    SELECT contact_id FROM session_speakers WHERE session_id = ${sessionId} AND event_id = ${eventId} ORDER BY sort_order, contact_id
  `);
  const speakerIds = (speakerRows.rows ?? []).map((speaker) => speaker.contact_id as ContactId);
  return toDto(row, speakerIds);
}

export const restoreSessionContent = (eventId: EventId, sessionId: SessionId, revisionId: string, actorUserId: UserId | null = null) =>
  restoreSessionContentIn(db, eventId, sessionId, revisionId, actorUserId);

export async function deleteSessionIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  sessionId: SessionId,
  expectedVersion: number,
): Promise<void> {
  // `session_speakers` cascades from the composite FK, so one statement is the
  // whole delete.
  const result = await dbOrTx.execute<{ id: string }>(sql`
    DELETE FROM sessions WHERE id = ${sessionId} AND event_id = ${eventId} AND row_version = ${expectedVersion}
    RETURNING id
  `);
  if ((result.rows ?? []).length > 0) return;
  const existing = await dbOrTx.execute<{ row_version: number }>(sql`
    SELECT row_version FROM sessions WHERE id = ${sessionId} AND event_id = ${eventId}
  `);
  const row = (existing.rows ?? [])[0];
  if (!row) throw new AppError("NOT_FOUND", "Session not found");
  throw new AppError("STALE_WRITE", STALE_MESSAGE, { expectedVersion, actualVersion: Number(row.row_version) });
}

export const deleteSession = (eventId: EventId, sessionId: SessionId, expectedVersion: number) =>
  deleteSessionIn(db, eventId, sessionId, expectedVersion);

/**
 * The List view's bulk publish/unpublish. Rows already in the target state are
 * skipped, so a second click is a no-op rather than a second revision bump and a
 * second round of mail.
 */
export async function bulkSetPublishedIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  ids: readonly SessionId[],
  published: boolean,
): Promise<{ changed: number; emailsQueued: number }> {
  if (ids.length === 0) return { changed: 0, emailsQueued: 0 };
  const status: SessionStatus = published ? "published" : "draft";

  const unscheduledCandidates = async () => {
    const rows = await dbOrTx.execute<{ id: string }>(sql`
      SELECT id FROM sessions
      WHERE event_id = ${eventId}
        AND id = ANY(${uuidArraySql(ids)})
        AND status IS DISTINCT FROM 'published'
        AND (starts_at IS NULL OR ends_at IS NULL)
      ORDER BY id
    `);
    return rows.rows ?? [];
  };

  if (published) {
    const unscheduled = await unscheduledCandidates();
    if (unscheduled.length > 0) {
      throw new AppError(
        "VALIDATION",
        `Schedule ${unscheduled.length} selected session${unscheduled.length === 1 ? "" : "s"} before publishing`,
        { unscheduledSessionIds: unscheduled.map((row) => row.id) },
      );
    }
  }

  const result = await dbOrTx.execute<{
    id: string; status: SessionStatus; starts_at: string | Date | null; schedule_revision: number;
    prior_status: SessionStatus; prior_starts_at: string | Date | null; prior_revision: number;
  }>(sql`
    WITH prior AS (
      SELECT id, status, starts_at, ends_at, schedule_revision FROM sessions
      WHERE event_id = ${eventId} AND id = ANY(${uuidArraySql(ids)})
    ), blockers AS MATERIALIZED (
      SELECT id FROM prior
      WHERE ${status}::text = 'published'
        AND status IS DISTINCT FROM 'published'
        AND (starts_at IS NULL OR ends_at IS NULL)
    ), upd AS (
      UPDATE sessions s SET
        status = ${status},
        row_version = s.row_version + 1,
        schedule_revision = s.schedule_revision + CASE WHEN ${status}::text = 'published' AND s.starts_at IS NOT NULL THEN 1 ELSE 0 END,
        updated_at = now()
      FROM prior
      WHERE s.id = prior.id
        AND s.event_id = ${eventId}
        AND s.status IS DISTINCT FROM ${status}
        AND NOT EXISTS (SELECT 1 FROM blockers)
        AND (${status}::text <> 'published' OR (s.starts_at IS NOT NULL AND s.ends_at IS NOT NULL))
      RETURNING s.id, s.status, s.starts_at, s.schedule_revision,
                prior.status AS prior_status, prior.starts_at AS prior_starts_at, prior.schedule_revision AS prior_revision
    )
    SELECT * FROM upd
  `);
  const rows = result.rows ?? [];
  if (rows.length === 0) {
    // The CTE repeats the all-or-none blocker test inside the UPDATE snapshot.
    // If a concurrent edit removed a time after the friendly preflight above,
    // surface the same actionable error instead of claiming a successful
    // no-op. The direct UPDATE predicate is the final defense against ever
    // writing a published-but-publicly-invisible row.
    if (published) {
      const unscheduled = await unscheduledCandidates();
      if (unscheduled.length > 0) {
        throw new AppError(
          "VALIDATION",
          `Schedule ${unscheduled.length} selected session${unscheduled.length === 1 ? "" : "s"} before publishing`,
          { unscheduledSessionIds: unscheduled.map((row) => row.id) },
        );
      }
    }
    return { changed: 0, emailsQueued: 0 };
  }

  const speakers = await dbOrTx.execute<{ session_id: string; contact_id: string }>(sql`
    SELECT session_id, contact_id FROM session_speakers
    WHERE event_id = ${eventId} AND session_id = ANY(${uuidArraySql(rows.map((row) => row.id))})
    ORDER BY session_id, sort_order, contact_id
  `);
  const bySession = new Map<string, ContactId[]>();
  for (const row of speakers.rows ?? []) {
    const bucket = bySession.get(row.session_id);
    if (bucket) bucket.push(row.contact_id as ContactId);
    else bySession.set(row.session_id, [row.contact_id as ContactId]);
  }

  let emailsQueued = 0;
  for (const row of rows) {
    emailsQueued += await notifySchedule(
      dbOrTx, eventId, row.id as SessionId,
      { status: row.prior_status, startsAt: iso(row.prior_starts_at), scheduleRevision: Number(row.prior_revision) },
      { status: row.status, startsAt: iso(row.starts_at), scheduleRevision: Number(row.schedule_revision) },
      bySession.get(row.id) ?? [],
    );
  }
  return { changed: rows.length, emailsQueued };
}

export const bulkSetPublished = (eventId: EventId, ids: readonly SessionId[], published: boolean) =>
  withTx((tx) => bulkSetPublishedIn(tx, eventId, ids, published));

/**
 * An accepted abstract becomes a draft session, once.
 *
 * The idempotency check comes first and `sessions.submission_id` is UNIQUE, so a
 * double-click, a retried request and a second organizer clicking the same
 * button all converge on the same session rather than forking the programme.
 */
export async function promoteSubmissionIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  submissionId: SubmissionId,
): Promise<{ sessionId: SessionId; outcome: "created" | "already_existed" }> {
  const existing = await dbOrTx.execute<{ id: string }>(sql`
    SELECT id FROM sessions WHERE submission_id = ${submissionId} AND event_id = ${eventId}
  `);
  const already = (existing.rows ?? [])[0];
  if (already) return { sessionId: already.id as SessionId, outcome: "already_existed" };

  const source = await dbOrTx.execute<{
    id: string; title: string; description_html: string | null; track_id: string | null; format_id: string | null;
    starts_at: string | Date | null; ends_at: string | Date | null; status: string;
  }>(sql`
    SELECT id, title, description_html, track_id, format_id, starts_at, ends_at, status
    FROM submissions WHERE id = ${submissionId} AND event_id = ${eventId}
  `);
  const row = (source.rows ?? [])[0];
  if (!row) throw new AppError("NOT_FOUND", "Submission not found");
  if (row.status !== "accepted") throw new AppError("VALIDATION", "Only accepted abstracts can be added to the agenda");

  const participants = await dbOrTx.execute<{ contact_id: string; is_primary: boolean; sort_order: number }>(sql`
    SELECT contact_id, is_primary, sort_order FROM submission_participants
    WHERE submission_id = ${submissionId} AND event_id = ${eventId}
    ORDER BY sort_order, contact_id
  `);
  const speakers = participants.rows ?? [];
  // One VALUES row per participant, bound element by element. An empty list
  // drops the whole insert branch rather than emitting `VALUES ()`, which is not
  // valid SQL.
  const speakerRows = speakers.length === 0 ? null : sql.join(
    speakers.map((speaker) => sql`(${speaker.contact_id}::uuid, ${speaker.is_primary}::boolean, ${Number(speaker.sort_order)}::int)`),
    sql`, `,
  );

  // Already sanitized on the submission's own write path; re-run anyway rather
  // than depend on another feature's discipline staying correct.
  const descriptionHtml = sanitize(row.description_html ?? "");
  // Proto-session times carry over when the Add Abstract drawer set them;
  // otherwise the session lands in the tray with both NULL, which the CHECK
  // requires anyway.
  const startsAt = row.starts_at === null || row.ends_at === null ? null : iso(row.starts_at);
  const endsAt = startsAt === null ? null : iso(row.ends_at);
  // `sessions` has the ordering CHECK that `submissions` lacks, so a pair that
  // was inverted on the abstract would reach the INSERT below as an unmapped
  // 23514 and leave the organizer with a 500. Say what is wrong instead, and
  // name the times so the fix is a drawer edit rather than a support ticket.
  if (startsAt !== null && endsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new AppError("VALIDATION", `This abstract ends (${endsAt}) before it starts (${startsAt}) — fix its times before promoting it`);
  }

  const base = slugify(row.title) || "session";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const insertSessionSql = sql`
      INSERT INTO sessions (event_id, submission_id, title, slug, description_html, track_id, format_id, starts_at, ends_at, status)
      SELECT ${eventId}, ${submissionId}, ${row.title}, ${slug}, ${descriptionHtml}, ${row.track_id}, ${row.format_id},
             ${startsAt}, ${endsAt}, 'draft'
      FROM event_guard
      RETURNING id
    `;
    try {
      const created = speakerRows === null
        ? await dbOrTx.execute<{ id: string }>(sql`
            WITH event_guard AS (${serializeScheduleWriteSql(eventId, startsAt, endsAt)}), s AS (${insertSessionSql})
            SELECT id FROM s
          `)
        : await dbOrTx.execute<{ id: string }>(sql`
            WITH event_guard AS (${serializeScheduleWriteSql(eventId, startsAt, endsAt)}), s AS (${insertSessionSql}), ins AS (
              INSERT INTO session_speakers (event_id, session_id, contact_id, role, sort_order)
              SELECT ${eventId}, s.id, x.contact_id,
                     (CASE WHEN x.is_primary THEN 'speaker' ELSE 'co_speaker' END)::participant_role, x.sort_order
              FROM s, (VALUES ${speakerRows}) AS x(contact_id, is_primary, sort_order)
              RETURNING session_id
            )
            SELECT id FROM s
          `);
      const sessionId = (created.rows ?? [])[0]?.id;
      if (!sessionId) {
        await assertWithinEventBounds(dbOrTx, eventId, startsAt, endsAt);
        throw new AppError("INTERNAL", "The session could not be created");
      }
      return { sessionId: sessionId as SessionId, outcome: "created" };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A racing promotion of the *same* submission wins on `submission_id`;
      // return its session rather than looking for a free slug forever.
      const raced = await dbOrTx.execute<{ id: string }>(sql`
        SELECT id FROM sessions WHERE submission_id = ${submissionId} AND event_id = ${eventId}
      `);
      const winner = (raced.rows ?? [])[0];
      if (winner) return { sessionId: winner.id as SessionId, outcome: "already_existed" };
    }
  }
  throw new AppError("CONFLICT", "Could not find a free URL for that title — rename the abstract");
}

export const promoteSubmission = (eventId: EventId, submissionId: SubmissionId) =>
  promoteSubmissionIn(db, eventId, submissionId);

/**
 * Promote independent accepted abstracts without turning one bad row into an
 * all-or-nothing batch. Each write retains `promoteSubmissionIn`'s unique-key
 * idempotency; deterministic row rejections are returned beside successes,
 * while an unknown failure aborts the response so the client treats every
 * unreported row as unconfirmed and safely retries after refreshing.
 */
export async function bulkPromoteSubmissionsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  submissionIds: readonly SubmissionId[],
): Promise<BulkAgendaPromotionResult> {
  if (submissionIds.length === 0 || submissionIds.length > MAX_BULK_AGENDA_PROMOTIONS) {
    throw new AppError("VALIDATION", `Select between 1 and ${MAX_BULK_AGENDA_PROMOTIONS} abstracts`);
  }
  if (new Set(submissionIds).size !== submissionIds.length) {
    throw new AppError("VALIDATION", "Each abstract may only be selected once");
  }

  const results: AgendaPromotionResultItem[] = [];
  for (const submissionId of submissionIds) {
    try {
      const promoted = await promoteSubmissionIn(dbOrTx, eventId, submissionId);
      results.push({ submissionId, ...promoted });
    } catch (error) {
      if (error instanceof AppError && ["NOT_FOUND", "VALIDATION", "CONFLICT"].includes(error.code)) {
        results.push({
          submissionId,
          outcome: "rejected",
          code: error.code as "NOT_FOUND" | "VALIDATION" | "CONFLICT",
          message: error.message,
        });
        continue;
      }
      throw error;
    }
  }

  return {
    results,
    created: results.filter((row) => row.outcome === "created").length,
    alreadyExisted: results.filter((row) => row.outcome === "already_existed").length,
    rejected: results.filter((row) => row.outcome === "rejected").length,
  };
}

export const bulkPromoteSubmissions = (eventId: EventId, submissionIds: readonly SubmissionId[]) =>
  bulkPromoteSubmissionsIn(db, eventId, submissionIds);

/**
 * Audited `withTx` path #8.
 *
 * The row is locked, its version checked, and the update, the revision bump and
 * the speakers' outbox rows commit together. A drag that lands is a drag whose
 * speakers were told; a drag that loses the version race changes nothing at all,
 * including `schedule_revision`.
 */
export async function moveSessionInTx(
  tx: TxDb,
  eventId: EventId,
  input: MoveSessionInput,
): Promise<{ session: ScheduledSessionDTO; speakerIds: ContactId[] }> {
  // All placement writes take locks in event -> session order. The transaction
  // keeps this guard locked through the session update and outbox inserts; doing
  // it before `FOR UPDATE` avoids a save-vs-drag lock-order inversion.
  const guarded = await tx.execute<{ id: string }>(serializeScheduleWriteSql(eventId, input.startsAt, input.endsAt));
  if ((guarded.rows ?? []).length === 0) {
    await assertWithinEventBounds(tx, eventId, input.startsAt, input.endsAt);
    throw new AppError("NOT_FOUND", "Event not found");
  }

  const locked = await tx.execute<{
    id: string; status: SessionStatus; starts_at: string | Date | null; ends_at: string | Date | null;
    room_id: string | null; schedule_revision: number; row_version: number;
  }>(sql`
    SELECT id, status, starts_at, ends_at, room_id, schedule_revision, row_version
    FROM sessions WHERE id = ${input.id} AND event_id = ${eventId}
    FOR UPDATE
  `);
  const prior = (locked.rows ?? [])[0];
  if (!prior) throw new AppError("NOT_FOUND", "Session not found");
  if (Number(prior.row_version) !== input.version) {
    throw new AppError("STALE_WRITE", STALE_MESSAGE, { expectedVersion: input.version, actualVersion: Number(prior.row_version) });
  }
  await assertWithinEventBounds(tx, eventId, input.startsAt, input.endsAt);

  // `moveSession` never changes `status`, so the stored value and the incoming
  // one are the same row value and the simple form of the CASE is correct here.
  const updated = await tx.execute<SessionRowShape>(sql`
    UPDATE sessions SET
      starts_at = ${input.startsAt},
      ends_at = ${input.endsAt},
      room_id = ${input.roomId},
      row_version = row_version + 1,
      schedule_revision = schedule_revision + CASE
        WHEN status::text = 'published'
         AND (starts_at IS DISTINCT FROM ${input.startsAt}::timestamptz
              OR ends_at IS DISTINCT FROM ${input.endsAt}::timestamptz
              OR room_id IS DISTINCT FROM ${input.roomId}::uuid)
        THEN 1 ELSE 0 END,
      updated_at = now()
    WHERE id = ${input.id} AND event_id = ${eventId} AND row_version = ${input.version}
    RETURNING ${RETURNED_COLUMNS}
  `);
  const row = (updated.rows ?? [])[0];
  if (!row) throw new AppError("STALE_WRITE", STALE_MESSAGE, { expectedVersion: input.version });

  const speakerRows = await tx.execute<{ contact_id: string }>(sql`
    SELECT contact_id FROM session_speakers
    WHERE session_id = ${input.id} AND event_id = ${eventId}
    ORDER BY sort_order, contact_id
  `);
  const speakerIds = (speakerRows.rows ?? []).map((speaker) => speaker.contact_id as ContactId);

  await notifySchedule(
    tx, eventId, input.id,
    { status: prior.status, startsAt: iso(prior.starts_at), scheduleRevision: Number(prior.schedule_revision) },
    { status: row.status, startsAt: iso(row.starts_at), scheduleRevision: Number(row.schedule_revision) },
    speakerIds,
  );

  return { session: toDto(row, speakerIds), speakerIds };
}

export async function moveSession(
  eventId: EventId,
  rawInput: unknown,
): Promise<{ session: ScheduledSessionDTO; conflicts: ConflictDTO[] }> {
  const input = moveSessionInputSchema.parse(rawInput);
  const { session } = await withTx((tx) => moveSessionInTx(tx, eventId, input));

  // Read-only and after the commit: the fresh conflict list is what the grid
  // repaints from, and holding a transaction open for it buys nothing.
  const day = session.startsAt === null ? null : await dayOf(eventId, session.startsAt);
  const schedulable = await getSchedulableSessionsIn(db, eventId, day);
  return { session, conflicts: detectConflicts(schedulable) };
}

async function dayOf(eventId: EventId, startsAt: string): Promise<string | null> {
  const result = await db.execute<{ timezone: string }>(sql`SELECT timezone FROM events WHERE id = ${eventId}`);
  const timezone = (result.rows ?? [])[0]?.timezone;
  return timezone ? eventDayKey(startsAt, timezone) : null;
}
