import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { rooms, sessionFormats, tags, tracks } from "@/db/schema";
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
import { VOCAB_LABELS, vocabInputSchemaFor, type VocabInput, type VocabKind } from "../schemas";
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

/**
 * An omitted optional field (e.g. a color-only save that never mentions
 * `description`) must keep its current value, not fall back to a default and
 * silently wipe it — the same "re-state from `patch ?? current`" rule
 * `updateEventIn` uses. That means reading the row before writing it.
 */
async function updateRow(dbOrTx: DbOrTx, eventId: EventId, kind: VocabKind, id: string, input: VocabInput) {
  const now = new Date();
  switch (kind) {
    case "tracks": {
      const [current] = await dbOrTx.select().from(tracks).where(and(eq(tracks.id, id), eq(tracks.eventId, eventId))).limit(1);
      if (!current) return undefined;
      const [row] = await dbOrTx.update(tracks)
        .set({
          name: input.name,
          color: input.color ?? current.color,
          description: input.description !== undefined ? input.description : current.description,
          updatedAt: now,
        })
        .where(and(eq(tracks.id, id), eq(tracks.eventId, eventId)))
        .returning();
      return row;
    }
    case "rooms": {
      const [current] = await dbOrTx.select().from(rooms).where(and(eq(rooms.id, id), eq(rooms.eventId, eventId))).limit(1);
      if (!current) return undefined;
      const [row] = await dbOrTx.update(rooms)
        .set({ name: input.name, capacity: input.capacity !== undefined ? input.capacity : current.capacity, updatedAt: now })
        .where(and(eq(rooms.id, id), eq(rooms.eventId, eventId)))
        .returning();
      return row;
    }
    case "formats": {
      const [current] = await dbOrTx.select().from(sessionFormats).where(and(eq(sessionFormats.id, id), eq(sessionFormats.eventId, eventId))).limit(1);
      if (!current) return undefined;
      const [row] = await dbOrTx.update(sessionFormats)
        .set({ name: input.name, defaultDurationMins: input.defaultDurationMins ?? current.defaultDurationMins, updatedAt: now })
        .where(and(eq(sessionFormats.id, id), eq(sessionFormats.eventId, eventId)))
        .returning();
      return row;
    }
    case "tags": {
      const [row] = await dbOrTx.update(tags)
        .set({ name: input.name, updatedAt: now })
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
  await dbOrTx.delete(table).where(and(eq(table.id, id), eq(table.eventId, eventId)));
}
export const deleteVocabItem = (eventId: EventId, kind: VocabKind, id: string) => deleteVocabItemIn(db, eventId, kind, id);

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
