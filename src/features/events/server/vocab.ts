import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, withTx, type DbOrTx } from "@/db/client";
import { embeds, rooms, sessionFormats, tags, tracks } from "@/db/schema";
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
import { isConstraintViolation } from "./db-errors";

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

type VocabDto = TrackDTO | RoomDTO | SessionFormatDTO | TagDTO;

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
      const [row] = await dbOrTx.insert(tracks).values({ eventId, name: input.name, color: input.color ?? "#6366f1", description: input.description ?? null, sortOrder }).returning();
      return row;
    }
    case "rooms": {
      const [row] = await dbOrTx.insert(rooms).values({ eventId, name: input.name, capacity: input.capacity ?? null, sortOrder }).returning();
      return row;
    }
    case "formats": {
      const [row] = await dbOrTx.insert(sessionFormats).values({ eventId, name: input.name, defaultDurationMins: input.defaultDurationMins ?? 30, sortOrder }).returning();
      return row;
    }
    case "tags": {
      const [row] = await dbOrTx.insert(tags).values({ eventId, name: input.name }).returning();
      return row;
    }
  }
}

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
      const [row] = await dbOrTx.update(rooms)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
          updatedAt: now,
        })
        .where(and(eq(rooms.id, id), eq(rooms.eventId, eventId)))
        .returning();
      return row;
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
  await dbOrTx.delete(table).where(and(eq(table.id, id), eq(table.eventId, eventId)));
}
export const deleteVocabItem = (eventId: EventId, kind: VocabKind, id: string) => withTx((tx) => deleteVocabItemIn(tx, eventId, kind, id));

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
