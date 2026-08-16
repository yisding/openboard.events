import { eq } from "drizzle-orm";
import type { DbOrTx, TxDb } from "@/db/client";
import { rooms, sessionFormats, tags, tracks } from "@/db/schema";
import type { EventId, FieldId, FormatId, FormId, OrganizationId, RoomId, TagId, TrackId, UserId } from "@/shared/contracts";
import { fieldIdSchema, formatIdSchema, formIdSchema, roomIdSchema, tagIdSchema, trackIdSchema } from "@/shared/contracts";
import { FORMATS, ROOMS, TAGS, TRACKS } from "../dataset";
import type { DemoDates } from "../clock";
import { demoId } from "../ids";

/**
 * What every demo provisioning phase receives, and the handful of lookups more
 * than one of them needs.
 *
 * The two things worth knowing about this shape:
 *
 * 1. **`now` is frozen.** It is `event_demo_tour.created_at`, captured once
 *    when the world's first phase ran, and `dates` is the whole temporal vector
 *    derived from it. Ten phases run in ten separate HTTP requests; if each
 *    read its own `new Date()`, a provision that straddled local midnight or
 *    resumed after a failure could land the agenda on a different wall-clock
 *    day than the event window — which would also un-plant the two conflicts
 *    the tour's best chapter is built around.
 * 2. **`inTransaction` is injected, not imported.** `withTx` opens its own Neon
 *    WebSocket pool from `DATABASE_URL`, which is exactly right in a Worker and
 *    unusable from a test database. Passing the runner in — the same shape
 *    `EvaluationTransaction` already uses for the same reason — lets the
 *    phases that need a `TxDb` (`createSubmissionIn`, the evaluation writers,
 *    the portal task writers) run against a real transaction in production and
 *    against the suite's own connection in tests, with no branch in the phase.
 */

/** The transaction runner a phase is handed. `withTx` in production. */
export type DemoTransaction = <T>(work: (tx: TxDb) => Promise<T>) => Promise<T>;

export type PhaseCtx = {
  dbOrTx: DbOrTx;
  inTransaction: DemoTransaction;
  eventId: EventId;
  organizationId: OrganizationId;
  /** The signed-in organizer. The demo's owner, and round one's only reviewer. */
  actorUserId: UserId;
  /** Frozen at the cursor's `created_at`. Never call `new Date()` in a phase. */
  now: Date;
  dates: DemoDates;
};

export type PhaseRunner = (ctx: PhaseCtx) => Promise<void>;

/**
 * The event's vocabulary, indexed by the dataset's stable keys.
 *
 * Resolved by **name** rather than by id on purpose. Four of the six demo
 * formats share a name with one of the five `seedEventDefaultsIn` writes inside
 * `createEventIn`, and `session_formats` is UNIQUE on `(event_id, name)`: phase
 * one therefore upserts formats onto whichever row already holds that name,
 * which keeps the platform's own id rather than minting a demo one. Reading the
 * index back means no later phase has to know which of its ids survived that
 * collision — and a name collision introduced in some future default for any of
 * the other three kinds is handled the same way, for free.
 */
export type DemoVocabIndex = {
  tracks: ReadonlyMap<string, TrackId>;
  rooms: ReadonlyMap<string, RoomId>;
  formats: ReadonlyMap<string, FormatId>;
  tags: ReadonlyMap<string, TagId>;
};

function indexByKey<Id>(
  rows: readonly { id: string; name: string }[],
  entries: readonly { key: string; name: string }[],
  parse: (value: string) => Id,
): ReadonlyMap<string, Id> {
  const byName = new Map(rows.map((row) => [row.name, row.id]));
  const index = new Map<string, Id>();
  for (const entry of entries) {
    const id = byName.get(entry.name);
    if (id) index.set(entry.key, parse(id));
  }
  return index;
}

export async function readDemoVocabIn(dbOrTx: DbOrTx, eventId: EventId): Promise<DemoVocabIndex> {
  const [trackRows, roomRows, formatRows, tagRows] = await Promise.all([
    dbOrTx.select({ id: tracks.id, name: tracks.name }).from(tracks).where(eq(tracks.eventId, eventId)),
    dbOrTx.select({ id: rooms.id, name: rooms.name }).from(rooms).where(eq(rooms.eventId, eventId)),
    dbOrTx.select({ id: sessionFormats.id, name: sessionFormats.name }).from(sessionFormats).where(eq(sessionFormats.eventId, eventId)),
    dbOrTx.select({ id: tags.id, name: tags.name }).from(tags).where(eq(tags.eventId, eventId)),
  ]);
  return {
    tracks: indexByKey(trackRows, TRACKS, (value) => trackIdSchema.parse(value)),
    rooms: indexByKey(roomRows, ROOMS, (value) => roomIdSchema.parse(value)),
    formats: indexByKey(formatRows, FORMATS, (value) => formatIdSchema.parse(value)),
    tags: indexByKey(tagRows, TAGS, (value) => tagIdSchema.parse(value)),
  };
}

/** The demo's own forms, by dataset key. Deterministic — no lookup needed. */
export function demoFormId(eventId: EventId, formKey: string): FormId {
  return formIdSchema.parse(demoId(eventId, `form:${formKey}`));
}

/**
 * A form field's id. Deterministic so an answer written in phase four can name
 * a field written in phase three without reading it back, and so re-running
 * phase three updates the question the player is looking at instead of adding a
 * second one beside it.
 */
export function demoFieldId(eventId: EventId, formKey: string, fieldKey: string): FieldId {
  return fieldIdSchema.parse(demoId(eventId, `field:${formKey}:${fieldKey}`));
}

/**
 * A dropdown/multiselect option's id. Option ids are what a conditional
 * visibility rule, a routing rule and an `{ t: "opt" }` answer all point at, so
 * all three are computed from the same function rather than passed around.
 */
export function demoOptionId(eventId: EventId, formKey: string, fieldKey: string, optionKey: string): string {
  return demoId(eventId, `option:${formKey}:${fieldKey}:${optionKey}`);
}

/** A contact row's id, by persona key. */
export function demoContactId(eventId: EventId, speakerKey: string): string {
  return demoId(eventId, `contact:${speakerKey}`);
}

/**
 * The replay key a submission carries in `client_session_id`.
 *
 * `createSubmissionIn` always inserts and only accepts a caller-supplied row id
 * for organizer-created (`manual`) abstracts — and these came in through the
 * call for speakers, so they are `cfp`. The seed solved the same problem the
 * same way: the key rides in `client_session_id`, and a re-run finds the row
 * instead of writing a twin.
 */
export function demoSubmissionKey(submissionKey: string): string {
  return `demo:submission:${submissionKey}`;
}

