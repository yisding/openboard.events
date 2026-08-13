import { asc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { eventMembers, events, rooms, sessionFormats, tags, tracks } from "@/db/schema";
import {
  eventDtoSchema,
  memberRoleSchema,
  roomDtoSchema,
  sessionFormatDtoSchema,
  tagDtoSchema,
  trackDtoSchema,
  type EventDTO,
  type EventId,
  type EventAccessDTO,
  type RoomDTO,
  type SessionFormatDTO,
  type TagDTO,
  type TrackDTO,
  type UserId,
} from "@/shared/contracts";
import type { VocabKind } from "../schemas";

/**
 * Events' reads. Every function here is a single `neon-http` statement —
 * resolution #4 confines the WebSocket `withTx` pool to eight named runtime
 * functions, none of which live in this feature — so every export below takes
 * a `DbOrTx` only so PGlite tests can inject a pglite-backed drizzle handle;
 * the deployed callers always pass `db`.
 */

function toEventDto(row: typeof events.$inferSelect): EventDTO {
  return eventDtoSchema.parse({
    id: row.id,
    name: row.name,
    slug: row.slug,
    eventType: row.eventType,
    websiteUrl: row.websiteUrl,
    location: row.location,
    physicalAddress: row.physicalAddress,
    timezone: row.timezone,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    theme: row.theme,
    logoFileId: row.logoFileId,
    backgroundFileId: row.backgroundFileId,
    submissionCapPerUser: row.submissionCapPerUser,
    rowVersion: row.rowVersion,
  });
}

function toTrackDto(row: typeof tracks.$inferSelect): TrackDTO {
  return trackDtoSchema.parse({ id: row.id, name: row.name, color: row.color, description: row.description, sortOrder: row.sortOrder });
}

function toRoomDto(row: typeof rooms.$inferSelect): RoomDTO {
  return roomDtoSchema.parse({ id: row.id, name: row.name, capacity: row.capacity, sortOrder: row.sortOrder });
}

function toFormatDto(row: typeof sessionFormats.$inferSelect): SessionFormatDTO {
  return sessionFormatDtoSchema.parse({ id: row.id, name: row.name, defaultDurationMins: row.defaultDurationMins, sortOrder: row.sortOrder });
}

function toTagDto(row: typeof tags.$inferSelect): TagDTO {
  return tagDtoSchema.parse({ id: row.id, name: row.name });
}

export async function getEventIn(dbOrTx: DbOrTx, eventId: EventId): Promise<EventDTO | null> {
  const [row] = await dbOrTx.select().from(events).where(eq(events.id, eventId)).limit(1);
  return row ? toEventDto(row) : null;
}
export const getEvent = (eventId: EventId): Promise<EventDTO | null> => getEventIn(db, eventId);

/** The one documented R4 exception: resolves a slug to an event id, used everywhere downstream. */
export async function getEventBySlugIn(dbOrTx: DbOrTx, slug: string): Promise<EventDTO | null> {
  const [row] = await dbOrTx.select().from(events).where(eq(events.slug, slug)).limit(1);
  return row ? toEventDto(row) : null;
}
export const getEventBySlug = (slug: string): Promise<EventDTO | null> => getEventBySlugIn(db, slug);

/**
 * The `/events` switcher and index — soonest event first, so upcoming work
 * stays on top, and **scoped to the caller**.
 *
 * This was `select().from(events)` with no WHERE clause: M11 predates tenancy,
 * and `eventsHubAuth` admits any signed-in admin, so `GET
 * /api/internal/events` and the `/events` page handed every account the whole
 * fleet — name, slug, type, dates, timezone, theme, caps — across every
 * organization. Harmless while the install was single-tenant; the moment M44's
 * self-serve signup went live it meant a stranger could enumerate every
 * customer's event roster with one signup.
 *
 * The hub is an actionable list, not the broader organization directory, so
 * it follows the same `event_members` authority as `requireAdmin`. Workspace
 * membership alone belongs on the organization page, where inaccessible
 * events are rendered explicitly as locked instead of as links that fail.
 */
export async function listEventsIn(dbOrTx: DbOrTx, userId: UserId): Promise<EventAccessDTO[]> {
  const rows = await dbOrTx.select({ event: events, role: eventMembers.role })
    .from(eventMembers)
    .innerJoin(events, eq(events.id, eventMembers.eventId))
    .where(eq(eventMembers.userId, userId))
    .orderBy(asc(events.startsAt), asc(events.id));
  return rows.map((row) => ({ ...toEventDto(row.event), role: memberRoleSchema.parse(row.role) }));
}
export const listEvents = (userId: UserId): Promise<EventAccessDTO[]> => listEventsIn(db, userId);

export async function listTracksIn(dbOrTx: DbOrTx, eventId: EventId): Promise<TrackDTO[]> {
  const rows = await dbOrTx.select().from(tracks).where(eq(tracks.eventId, eventId)).orderBy(asc(tracks.sortOrder), asc(tracks.id));
  return rows.map(toTrackDto);
}
export const listTracks = (eventId: EventId): Promise<TrackDTO[]> => listTracksIn(db, eventId);

export async function listRoomsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<RoomDTO[]> {
  const rows = await dbOrTx.select().from(rooms).where(eq(rooms.eventId, eventId)).orderBy(asc(rooms.sortOrder), asc(rooms.id));
  return rows.map(toRoomDto);
}
export const listRooms = (eventId: EventId): Promise<RoomDTO[]> => listRoomsIn(db, eventId);

export async function listFormatsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<SessionFormatDTO[]> {
  const rows = await dbOrTx.select().from(sessionFormats).where(eq(sessionFormats.eventId, eventId)).orderBy(asc(sessionFormats.sortOrder), asc(sessionFormats.id));
  return rows.map(toFormatDto);
}
export const listFormats = (eventId: EventId): Promise<SessionFormatDTO[]> => listFormatsIn(db, eventId);

// Tags carry no `sort_order` column in the frozen schema (data-model M03): the
// vocabulary is small and unordered by design, so the tab lists them
// alphabetically and offers no drag handle — `reorderVocab` rejects the kind.
export async function listTagsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<TagDTO[]> {
  const rows = await dbOrTx.select().from(tags).where(eq(tags.eventId, eventId)).orderBy(asc(tags.name), asc(tags.id));
  return rows.map(toTagDto);
}
export const listTags = (eventId: EventId): Promise<TagDTO[]> => listTagsIn(db, eventId);

export async function listVocabIn(dbOrTx: DbOrTx, eventId: EventId, kind: VocabKind) {
  switch (kind) {
    case "tracks": return listTracksIn(dbOrTx, eventId);
    case "rooms": return listRoomsIn(dbOrTx, eventId);
    case "formats": return listFormatsIn(dbOrTx, eventId);
    case "tags": return listTagsIn(dbOrTx, eventId);
  }
}
export const listVocab = (eventId: EventId, kind: VocabKind) => listVocabIn(db, eventId, kind);

/** One round trip for the builder and every other downstream dropdown consumer. */
export async function getEventVocabularyIn(dbOrTx: DbOrTx, eventId: EventId): Promise<{
  tracks: TrackDTO[]; rooms: RoomDTO[]; formats: SessionFormatDTO[]; tags: TagDTO[];
}> {
  const [trackRows, roomRows, formatRows, tagRows] = await Promise.all([
    listTracksIn(dbOrTx, eventId),
    listRoomsIn(dbOrTx, eventId),
    listFormatsIn(dbOrTx, eventId),
    listTagsIn(dbOrTx, eventId),
  ]);
  return { tracks: trackRows, rooms: roomRows, formats: formatRows, tags: tagRows };
}
export const getEventVocabulary = (eventId: EventId) => getEventVocabularyIn(db, eventId);
