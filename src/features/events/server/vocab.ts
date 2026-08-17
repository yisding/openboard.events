import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { isConstraintViolation } from "@/db/errors";
import { embeds, rooms, sessionFormats, sessions, tags, tracks } from "@/db/schema";
import {
  roomDtoSchema,
  sessionFormatDtoSchema,
  tagDtoSchema,
  trackDtoSchema,
  type EventId,
  type RoomDTO,
  type SessionFormatDTO,
  type TagDTO,
  type TrackDTO,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { VOCAB_LABELS, vocabInputSchemaFor, vocabPatchSchemaFor, type VocabInput, type VocabKind, type VocabPatch } from "../schemas";
import { DEFAULT_BRAND_COLOR } from "@/shared/lib/brand-color";

/**
 * Vocabulary CRUD across the four kinds. The tables' columns genuinely differ
 * (color/description on tracks, capacity on rooms, duration on formats,
 * nothing extra on tags), so this is a `switch` per operation rather than one
 * generic function threaded through a lossy shared shape.
 */

const UNIQUE_CONSTRAINTS: Record<VocabKind, string> = {
  tracks: "tracks_event_id_name_key",
  rooms: "rooms_event_id_name_key",
  formats: "session_formats_event_id_name_key",
  tags: "tags_event_id_name_key",
};

const PRIMARY_KEY_CONSTRAINTS: Record<VocabKind, string> = {
  tracks: "tracks_pkey",
  rooms: "rooms_pkey",
  formats: "session_formats_pkey",
  tags: "tags_pkey",
};

type VocabDto = TrackDTO | RoomDTO | SessionFormatDTO | TagDTO;

type VocabDependency = { id: string; name: string };

function namedDependencies(label: string, rows: VocabDependency[]): string | null {
  if (rows.length === 0) return null;
  const shown = rows.slice(0, 5).map((row) => `“${row.name}”`).join(", ");
  const remainder = rows.length > 5 ? ` and ${rows.length - 5} more` : "";
  return `${label} ${shown}${remainder}`;
}

async function lockDeletionTarget(dbOrTx: DbOrTx, eventId: EventId, kind: VocabKind, id: string): Promise<boolean> {
  const tableName = kind === "tracks" ? "tracks" : kind === "rooms" ? "rooms" : kind === "formats" ? "session_formats" : "tags";
  const result = await dbOrTx.execute<{ id: string }>(sql`
    SELECT target.id FROM ${sql.raw(tableName)} AS target
    WHERE target.id = ${id} AND target.event_id = ${eventId}
    FOR UPDATE
  `);
  return (result.rows ?? []).length > 0;
}

async function formDependencies(
  dbOrTx: DbOrTx,
  eventId: EventId,
  kind: "tracks" | "formats",
  id: string,
): Promise<VocabDependency[]> {
  const binding = kind === "tracks" ? "trackId" : "formatId";
  const result = await dbOrTx.execute<VocabDependency>(sql`
    SELECT DISTINCT form.id, form.internal_name AS name
    FROM forms AS form
    WHERE form.event_id = ${eventId} AND (
      (form.status = 'open' AND EXISTS (
        SELECT 1 FROM form_fields AS field
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(field.options, '[]'::jsonb)) AS option
        WHERE field.form_id = form.id AND field.event_id = form.event_id
          AND field.deleted_at IS NULL AND option ->> ${binding} = ${id}
      ))
      OR ((form.status = 'open' OR EXISTS (
        SELECT 1 FROM portal_tasks AS task
        WHERE task.event_id = form.event_id AND task.form_id = form.id AND task.is_active
      )) AND EXISTS (
        SELECT 1 FROM form_versions AS version
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(version.snapshot -> 'sections', '[]'::jsonb)) AS section
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(section -> 'fields', '[]'::jsonb)) AS field
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(field -> 'options', '[]'::jsonb)) AS option
        WHERE version.form_id = form.id AND version.event_id = form.event_id
          AND version.version = (
            SELECT max(latest.version) FROM form_versions AS latest
            WHERE latest.form_id = form.id AND latest.event_id = form.event_id
          )
          AND option ->> ${binding} = ${id}
      ))
    )
    ORDER BY name, id
  `);
  return result.rows ?? [];
}

async function evaluationDependencies(dbOrTx: DbOrTx, eventId: EventId, id: string): Promise<VocabDependency[]> {
  const result = await dbOrTx.execute<VocabDependency>(sql`
    SELECT DISTINCT plan.id, plan.name
    FROM evaluation_plans AS plan
    LEFT JOIN reviewer_assignments AS reviewer ON reviewer.plan_id = plan.id AND reviewer.event_id = plan.event_id
    WHERE plan.event_id = ${eventId}
      AND (${id}::uuid = ANY(COALESCE(plan.track_ids, '{}'::uuid[]))
        OR ${id}::uuid = ANY(COALESCE(reviewer.track_ids, '{}'::uuid[])))
    ORDER BY plan.name, plan.id
  `);
  return result.rows ?? [];
}

async function assertDeletionHasNoDependencies(
  dbOrTx: DbOrTx,
  eventId: EventId,
  kind: "tracks" | "formats",
  id: string,
): Promise<void> {
  const forms = await formDependencies(dbOrTx, eventId, kind, id);
  const rounds = kind === "tracks" ? await evaluationDependencies(dbOrTx, eventId, id) : [];
  const named = [namedDependencies("forms", forms), namedDependencies("evaluation rounds", rounds)].filter(Boolean);
  if (named.length === 0) return;
  const label = kind === "tracks" ? "track" : "format";
  throw new AppError(
    "CONFLICT",
    `This ${label} is still used by ${named.join(" and ")}. Remove it there before deleting it.`,
    { forms, rounds },
  );
}

function toDto(kind: VocabKind, row: Record<string, unknown>): VocabDto {
  switch (kind) {
    case "tracks": return trackDtoSchema.parse({ id: row.id, name: row.name, color: row.color, description: row.description, sortOrder: row.sortOrder });
    case "rooms": return roomDtoSchema.parse({ id: row.id, name: row.name, capacity: row.capacity, sortOrder: row.sortOrder });
    case "formats": return sessionFormatDtoSchema.parse({ id: row.id, name: row.name, defaultDurationMins: row.defaultDurationMins, sortOrder: row.sortOrder });
    case "tags": return tagDtoSchema.parse({ id: row.id, name: row.name });
  }
}

async function nextSortOrder(dbOrTx: DbOrTx, eventId: EventId, kind: VocabKind): Promise<number> {
  const table = kind === "tracks" ? tracks : kind === "rooms" ? rooms : sessionFormats;
  const [row] = await dbOrTx.select({ sortOrder: table.sortOrder }).from(table).where(eq(table.eventId, eventId)).orderBy(desc(table.sortOrder)).limit(1);
  return (row?.sortOrder ?? -1) + 1;
}

async function insertRow(dbOrTx: DbOrTx, eventId: EventId, kind: VocabKind, input: VocabInput, sortOrder: number) {
  switch (kind) {
    case "tracks": {
      const [row] = await dbOrTx.insert(tracks).values({ id: input.id, eventId, name: input.name, color: input.color ?? DEFAULT_BRAND_COLOR, description: input.description ?? null, sortOrder }).returning();
      return row;
    }
    case "rooms": {
      const [row] = await dbOrTx.insert(rooms).values({ id: input.id, eventId, name: input.name, capacity: input.capacity ?? null, sortOrder }).returning();
      return row;
    }
    case "formats": {
      const [row] = await dbOrTx.insert(sessionFormats).values({ id: input.id, eventId, name: input.name, defaultDurationMins: input.defaultDurationMins ?? 30, sortOrder }).returning();
      return row;
    }
    case "tags": {
      const [row] = await dbOrTx.insert(tags).values({ id: input.id, eventId, name: input.name }).returning();
      return row;
    }
  }
}

async function findRowById(dbOrTx: DbOrTx, eventId: EventId, kind: VocabKind, id: string) {
  switch (kind) {
    case "tracks": {
      const [row] = await dbOrTx.select().from(tracks).where(and(eq(tracks.id, id), eq(tracks.eventId, eventId))).limit(1);
      return row;
    }
    case "rooms": {
      const [row] = await dbOrTx.select().from(rooms).where(and(eq(rooms.id, id), eq(rooms.eventId, eventId))).limit(1);
      return row;
    }
    case "formats": {
      const [row] = await dbOrTx.select().from(sessionFormats).where(and(eq(sessionFormats.id, id), eq(sessionFormats.eventId, eventId))).limit(1);
      return row;
    }
    case "tags": {
      const [row] = await dbOrTx.select().from(tags).where(and(eq(tags.id, id), eq(tags.eventId, eventId))).limit(1);
      return row;
    }
  }
}

function createRequestMatches(kind: VocabKind, row: Record<string, unknown>, input: VocabInput): boolean {
  if (row.name !== input.name) return false;
  switch (kind) {
    case "tracks": return row.color === (input.color ?? DEFAULT_BRAND_COLOR) && row.description === (input.description ?? null);
    case "rooms": return row.capacity === (input.capacity ?? null);
    case "formats": return row.defaultDurationMins === (input.defaultDurationMins ?? 30);
    case "tags": return true;
  }
}

function recoveredCreate(kind: VocabKind, row: Record<string, unknown>, input: VocabInput): VocabDto {
  if (!createRequestMatches(kind, row, input)) {
    throw new AppError("CONFLICT", `A different ${VOCAB_LABELS[kind]} already uses that creation request`);
  }
  return toDto(kind, row);
}

/**
 * Create-only vocabulary entry point. A caller-supplied id is a request
 * correlation token, never an update instruction: replaying the same payload
 * returns the original row, while reusing it for different content fails.
 * This lets first-use onboarding retry a response-lost POST without producing
 * a duplicate-name dead end or silently editing the committed track.
 */
export async function createVocabItemIn(dbOrTx: DbOrTx, eventId: EventId, kind: VocabKind, input: VocabInput): Promise<VocabDto> {
  const strict = vocabInputSchemaFor(kind).parse(input);
  if (strict.id) {
    const existing = await findRowById(dbOrTx, eventId, kind, strict.id);
    if (existing) return recoveredCreate(kind, existing as unknown as Record<string, unknown>, strict);
  }

  try {
    const sortOrder = await nextSortOrder(dbOrTx, eventId, kind);
    const row = await insertRow(dbOrTx, eventId, kind, strict, sortOrder);
    if (!row) throw new AppError("INTERNAL", `Could not create the ${VOCAB_LABELS[kind]}`);
    return toDto(kind, row);
  } catch (error) {
    if (strict.id) {
      // PostgreSQL may report either the primary-key or per-event name index
      // first when an exact replay collides with both. Correlate by id before
      // classifying the constraint, then verify the full create payload.
      const raced = await findRowById(dbOrTx, eventId, kind, strict.id);
      if (raced) return recoveredCreate(kind, raced as unknown as Record<string, unknown>, strict);
      if (isConstraintViolation(error, PRIMARY_KEY_CONSTRAINTS[kind])) {
        throw new AppError("CONFLICT", `That ${VOCAB_LABELS[kind]} creation request is already in use`);
      }
    }
    if (isConstraintViolation(error, UNIQUE_CONSTRAINTS[kind])) {
      throw new AppError("VALIDATION", `A ${VOCAB_LABELS[kind]} named “${strict.name}” already exists`, { field: "name" });
    }
    throw error;
  }
}
export const createVocabItem = (eventId: EventId, kind: VocabKind, input: VocabInput) => createVocabItemIn(db, eventId, kind, input);

/** PATCHes write only the named columns. Apart from avoiding a needless read,
 * this makes two serialized field edits composable: a color/capacity save can
 * never restate an older name and undo a rename. */
async function updateRow(dbOrTx: DbOrTx, eventId: EventId, kind: VocabKind, id: string, input: VocabPatch) {
  const now = new Date();
  switch (kind) {
    case "tracks": {
      const [row] = await dbOrTx.update(tracks)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          updatedAt: now,
        })
        .where(and(eq(tracks.id, id), eq(tracks.eventId, eventId)))
        .returning();
      return row;
    }
    case "rooms": {
      const nextName = input.name === undefined ? sql`room.name` : sql`${input.name}`;
      const nextCapacity = input.capacity === undefined ? sql`room.capacity` : sql`${input.capacity}`;
      const result = await dbOrTx.execute<{ id: string; name: string; capacity: number | null; sortOrder: number }>(sql`
        WITH prior AS MATERIALIZED (
          SELECT id, name FROM rooms
          WHERE id = ${id} AND event_id = ${eventId}
          FOR UPDATE
        ), room_update AS (
          UPDATE rooms AS room SET
            name = ${nextName},
            capacity = ${nextCapacity},
            updated_at = ${now}
          FROM prior
          WHERE room.id = prior.id AND room.event_id = ${eventId}
          RETURNING room.id, room.name, room.capacity, room.sort_order, prior.name AS prior_name
        ), revision_bumps AS (
          UPDATE ${sessions} AS session SET
            schedule_revision = session.schedule_revision + 1,
            updated_at = greatest(session.updated_at + interval '1 millisecond', clock_timestamp())
          FROM room_update
          WHERE room_update.name IS DISTINCT FROM room_update.prior_name
            AND session.event_id = ${eventId}
            AND session.room_id = room_update.id
            AND session.status::text = 'published'
            AND session.starts_at IS NOT NULL
          RETURNING session.id
        )
        SELECT room_update.id, room_update.name, room_update.capacity,
               room_update.sort_order AS "sortOrder"
        FROM room_update
        CROSS JOIN (SELECT count(*) FROM revision_bumps) AS applied
      `);
      return (result.rows ?? [])[0];
    }
    case "formats": {
      const [row] = await dbOrTx.update(sessionFormats)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.defaultDurationMins !== undefined ? { defaultDurationMins: input.defaultDurationMins } : {}),
          updatedAt: now,
        })
        .where(and(eq(sessionFormats.id, id), eq(sessionFormats.eventId, eventId)))
        .returning();
      return row;
    }
    case "tags": {
      const [row] = await dbOrTx.update(tags)
        .set({ ...(input.name !== undefined ? { name: input.name } : {}), updatedAt: now })
        .where(and(eq(tags.id, id), eq(tags.eventId, eventId)))
        .returning();
      return row;
    }
  }
}

/**
 * Create when `input.id` is absent, update in place otherwise — the single
 * `saveVocabItem` shape the barrel promises. 23505 on the per-event unique
 * name maps to a field-scoped, human message instead of a 500.
 */
export async function saveVocabItemIn(dbOrTx: DbOrTx, eventId: EventId, kind: VocabKind, input: VocabInput): Promise<VocabDto> {
  const strict = vocabInputSchemaFor(kind).parse(input);
  try {
    if (strict.id) {
      const row = await updateRow(dbOrTx, eventId, kind, strict.id, strict);
      if (!row) throw new AppError("NOT_FOUND", `That ${VOCAB_LABELS[kind]} no longer exists`);
      return toDto(kind, row);
    }
    const sortOrder = await nextSortOrder(dbOrTx, eventId, kind);
    const row = await insertRow(dbOrTx, eventId, kind, strict, sortOrder);
    if (!row) throw new AppError("INTERNAL", `Could not create the ${VOCAB_LABELS[kind]}`);
    return toDto(kind, row);
  } catch (error) {
    if (isConstraintViolation(error, UNIQUE_CONSTRAINTS[kind])) {
      throw new AppError("VALIDATION", `A ${VOCAB_LABELS[kind]} named “${strict.name}” already exists`, { field: "name" });
    }
    throw error;
  }
}
export const saveVocabItem = (eventId: EventId, kind: VocabKind, input: VocabInput) => saveVocabItemIn(db, eventId, kind, input);

export async function patchVocabItemIn(dbOrTx: DbOrTx, eventId: EventId, kind: VocabKind, id: string, input: VocabPatch): Promise<VocabDto> {
  const strict = vocabPatchSchemaFor(kind).parse(input) as VocabPatch;
  try {
    const row = await updateRow(dbOrTx, eventId, kind, id, strict);
    if (!row) throw new AppError("NOT_FOUND", `That ${VOCAB_LABELS[kind]} no longer exists`);
    return toDto(kind, row);
  } catch (error) {
    if (isConstraintViolation(error, UNIQUE_CONSTRAINTS[kind])) {
      throw new AppError("VALIDATION", `A ${VOCAB_LABELS[kind]} named “${strict.name}” already exists`, { field: "name" });
    }
    throw error;
  }
}
export const patchVocabItem = (eventId: EventId, kind: VocabKind, id: string, input: VocabPatch) => patchVocabItemIn(db, eventId, kind, id, input);

/**
 * FKs decide the blast radius, not this function: `submissions.track_id` /
 * `format_id` are `ON DELETE SET NULL`, `submission_tags` is `CASCADE`, and a
 * routing rule that named this track is left dangling on purpose (M13b
 * soft-disables it) — deleting here never reaches into `routing_rules`.
 * Deleting an id that no longer exists is a silent no-op, which keeps a
 * double-click idempotent.
 */
export async function deleteVocabItemIn(dbOrTx: DbOrTx, eventId: EventId, kind: VocabKind, id: string): Promise<void> {
  // The reference guards installed by migration 0040 take FOR KEY SHARE when
  // JSON/array dependencies are written. Taking FOR UPDATE here makes the
  // dependency check and delete one serial order: a concurrent writer either
  // commits first and is observed below, or waits and then rejects its missing
  // vocabulary id. The production export keeps this lock through every cleanup.
  if (!await lockDeletionTarget(dbOrTx, eventId, kind, id)) return;
  if (kind === "tracks" || kind === "formats") {
    await assertDeletionHasNoDependencies(dbOrTx, eventId, kind, id);
  }
  const table = kind === "tracks" ? tracks : kind === "rooms" ? rooms : kind === "formats" ? sessionFormats : tags;
  const filterKey = kind === "tracks" ? "trackIds" : kind === "rooms" ? "roomIds" : kind === "formats" ? "formatIds" : null;
  if (filterKey) {
    // Mutate only the affected JSON array from the row version PostgreSQL
    // locks for this UPDATE. A read/modify/write loop could overwrite a
    // concurrent style/field/filter edit with the stale object it selected.
    await dbOrTx.update(embeds).set({
      filters: sql`jsonb_set(
        ${embeds.filters},
        ARRAY[${filterKey}]::text[],
        COALESCE((
          SELECT jsonb_agg(entries.value ORDER BY entries.position)
          FROM jsonb_array_elements(${embeds.filters} -> ${filterKey}) WITH ORDINALITY AS entries(value, position)
          WHERE entries.value <> to_jsonb(${id}::text)
        ), '[]'::jsonb),
        false
      )`,
      updatedAt: new Date(),
    }).where(and(
      eq(embeds.eventId, eventId),
      sql`jsonb_typeof(${embeds.filters} -> ${filterKey}) = 'array'`,
      sql`(${embeds.filters} -> ${filterKey}) @> jsonb_build_array(${id}::text)`,
    ));
  }
  if (kind === "rooms") {
    // Clear the assignment ourselves before deleting the room so the FK's
    // ON DELETE SET NULL has no second write to perform. Published, scheduled
    // sessions advance exactly once because LOCATION changed; drafts retain
    // the existing no-public-revision behavior.
    //
    // MTP-16 §17: a published, timed session now owes its speakers one "schedule
    // changed" notice, and this statement cannot send it — the notifier lives in
    // the agenda feature, and importing it here would close the import cycle
    // `events <- forms <- portal <- agenda`. So the debt is recorded on the same
    // rows whose revision advanced and `dischargeStrandedScheduleNoticesIn`
    // settles it, inside this transaction, from the deleting route. The flag —
    // not revision arithmetic — is what identifies those rows afterwards: a
    // title/description bump advances the same revision and deliberately mails
    // nobody.
    await dbOrTx.execute(sql`
      WITH target AS MATERIALIZED (
        SELECT id FROM ${rooms}
        WHERE ${rooms.id} = ${id} AND ${rooms.eventId} = ${eventId}
        FOR UPDATE
      ), cleared AS (
        UPDATE ${sessions} AS session SET
          room_id = NULL,
          schedule_revision = session.schedule_revision + CASE
            WHEN session.status::text = 'published' AND session.starts_at IS NOT NULL THEN 1 ELSE 0 END,
          schedule_notice_owed = session.schedule_notice_owed
            OR (session.status::text = 'published' AND session.starts_at IS NOT NULL),
          updated_at = greatest(session.updated_at + interval '1 millisecond', clock_timestamp())
        FROM target
        WHERE session.event_id = ${eventId} AND session.room_id = target.id
        RETURNING session.id
      ), cleared_count AS (
        SELECT count(*) FROM cleared
      )
      DELETE FROM ${rooms} AS room
      USING target, cleared_count
      WHERE room.id = target.id AND room.event_id = ${eventId}
    `);
  } else {
    await dbOrTx.delete(table).where(and(eq(table.id, id), eq(table.eventId, eventId)));
  }
}
// No `deleteVocabItem(eventId, …)` convenience wrapper, unlike every other
// mutation here. Deleting a room owes its stranded speakers a notice that this
// feature cannot enqueue (see the rooms branch above), so the transaction is
// opened by the DELETE route, which can reach both halves. A wrapper that
// opened its own would be the shorter call every future caller reaches for, and
// every one of them would silently skip the notices.

/**
 * Renumbers the whole list 0..n-1 in one statement — no fractional ranks, no
 * interleaved duplicates. `orderedIds` must be exactly the kind's current id
 * set, or the caller is racing a concurrent add/delete and should reload.
 */
export async function reorderVocabIn(dbOrTx: DbOrTx, eventId: EventId, kind: VocabKind, orderedIds: string[]): Promise<void> {
  if (kind === "tags") throw new AppError("VALIDATION", "Tags do not support manual ordering");
  const table = kind === "tracks" ? tracks : kind === "rooms" ? rooms : sessionFormats;
  const current = await dbOrTx.select({ id: table.id }).from(table).where(eq(table.eventId, eventId)).orderBy(asc(table.id));
  const currentIds = new Set(current.map((row) => row.id));
  const requestedIds = new Set(orderedIds);
  if (orderedIds.length !== currentIds.size || requestedIds.size !== orderedIds.length || [...currentIds].some((id) => !requestedIds.has(id))) {
    throw new AppError("VALIDATION", "orderedIds must contain exactly the current set of ids, once each");
  }
  const values = orderedIds.map((id, index) => sql`(${id}::uuid, ${index}::int)`);
  // `kind` is one of three internal enum literals, never user input, so
  // splicing the table name via `sql.raw` (drizzle's identifier idiom — see
  // `scripts/seed/index.ts`'s `wipeAll`) is not an injection risk.
  const tableName = kind === "tracks" ? "tracks" : kind === "rooms" ? "rooms" : "session_formats";
  await dbOrTx.execute(sql`
    UPDATE ${sql.raw(tableName)} AS t SET sort_order = v.ord, updated_at = now()
    FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, ord)
    WHERE t.id = v.id AND t.event_id = ${eventId}
  `);
}
export const reorderVocab = (eventId: EventId, kind: VocabKind, orderedIds: string[]) => reorderVocabIn(db, eventId, kind, orderedIds);
