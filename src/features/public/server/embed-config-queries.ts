import { and, asc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { embeds } from "@/db/schema";
import { AppError } from "@/shared/lib/errors";
import {
  CANONICAL_EMBED_TYPES,
  embedConfigDtoSchema,
  embedFiltersSchema,
  embedStyleSchema,
  type CanonicalEmbedContentType,
  type EmbedConfigDTO,
  type EventId,
} from "../embed-config-types";
import { cachePublicRead } from "./cache";

/**
 * Embed kill-switch + appearance + filter reads/writes over the `embeds`
 * table — see the M33/M53 work orders' Provides sections. `embeds` has no
 * unique constraint on `(event_id, content_type)` (it is a general
 * multi-type table); this module only ever touches the five canonical types
 * above.
 */

const DEFAULT_EMBED_NAME: Record<CanonicalEmbedContentType, string> = {
  agenda: "Agenda",
  session_list: "Sessions list",
  schedule_itinerary: "Schedule itinerary",
  speaker_list: "Speakers list",
  speaker_gallery: "Speaker gallery",
};

function toDto(row: typeof embeds.$inferSelect): EmbedConfigDTO {
  return embedConfigDtoSchema.parse({
    id: row.id,
    eventId: row.eventId,
    contentType: row.contentType,
    enabled: row.enabled,
    style: embedStyleSchema.parse(row.style ?? {}),
    filters: embedFiltersSchema.parse(row.filters ?? {}),
  });
}

export type PublicEmbedConfig = Pick<EmbedConfigDTO, "enabled" | "style" | "filters">;

function toPublicConfig(row: typeof embeds.$inferSelect | null): PublicEmbedConfig {
  return {
    enabled: row?.enabled ?? true,
    style: embedStyleSchema.parse(row?.style ?? {}),
    filters: embedFiltersSchema.parse(row?.filters ?? {}),
  };
}

async function findRow(dbOrTx: DbOrTx, eventId: EventId, contentType: CanonicalEmbedContentType) {
  // `ORDER BY created_at LIMIT 1` — the earliest row wins if the benign
  // check-then-insert race below ever produces a duplicate for the pair.
  const [row] = await dbOrTx
    .select()
    .from(embeds)
    .where(and(eq(embeds.eventId, eventId), eq(embeds.contentType, contentType)))
    .orderBy(asc(embeds.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Read the kill switch without creating a default config row. Absence means
 * "never configured, still enabled" so public embeds can serve before an
 * admin first visits settings.
 */
export async function isEmbedEnabledIn(dbOrTx: DbOrTx, eventId: EventId, contentType: CanonicalEmbedContentType): Promise<boolean> {
  const row = await findRow(dbOrTx, eventId, contentType);
  return row?.enabled ?? true;
}

/**
 * Public rendering is read-only. A missing row means the documented enabled,
 * default-style state; the speaker-list compatibility read inherits the old
 * gallery row until the admin screen materializes its canonical replacement.
 */
export async function getPublicEmbedConfigIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contentType: CanonicalEmbedContentType,
): Promise<PublicEmbedConfig> {
  const canonical = await findRow(dbOrTx, eventId, contentType);
  if (canonical || contentType !== "speaker_list") return toPublicConfig(canonical);
  return toPublicConfig(await findRow(dbOrTx, eventId, "speaker_gallery"));
}

export function getPublicEmbedConfig(
  eventId: EventId,
  contentType: CanonicalEmbedContentType,
): Promise<PublicEmbedConfig> {
  return cachePublicRead(
    eventId,
    `embed:${contentType}`,
    () => getPublicEmbedConfigIn(db, eventId, contentType),
  );
}

/**
 * Reads the config row, creating a default (enabled, no style overrides) row
 * on first visit. The check-then-insert here is a known, accepted race for a
 * single-admin hackathon demo (M33 work order Step 2) — two admins opening
 * the settings page for the very first time simultaneously could create two
 * rows; `findRow`'s `ORDER BY created_at LIMIT 1` keeps reads deterministic
 * either way.
 */
export async function getOrCreateEmbedConfigIn(dbOrTx: DbOrTx, eventId: EventId, contentType: CanonicalEmbedContentType): Promise<EmbedConfigDTO> {
  const existing = await findRow(dbOrTx, eventId, contentType);
  if (existing) return toDto(existing);
  await dbOrTx
    .insert(embeds)
    .values({ eventId, contentType, name: DEFAULT_EMBED_NAME[contentType], enabled: true, style: {}, filters: {} });
  // Re-read rather than returning the row just inserted. There is no unique
  // index on (event_id, content_type), and `findRow` deliberately takes the
  // *earliest* row — so two admins opening the embeds page at once for a
  // never-configured event both insert, and the one that returned its own row
  // then PATCHed the duplicate forever. Every toggle, the kill switch included,
  // looked saved while the public route kept serving the other row.
  const created = await findRow(dbOrTx, eventId, contentType);
  if (!created) throw new AppError("INTERNAL", "Could not create the embed config");
  return toDto(created);
}
export const getOrCreateEmbedConfig = (eventId: EventId, contentType: CanonicalEmbedContentType): Promise<EmbedConfigDTO> =>
  getOrCreateEmbedConfigIn(db, eventId, contentType);

/**
 * M53 legacy-URL continuity: before M53's five-surface split, the
 * `/embed/[slug]/speakers` route slug served the `speaker_gallery` content
 * type (see M33). M53 reassigns that same "speakers" slug to the new
 * `speaker_list` surface (embeds-admin-page.tsx's `TYPE_META`), so an event
 * that already configured — disabled, restyled — its `speaker_gallery` embed
 * before this deploy must not have that continuity silently reset to
 * enabled/default styling just because the row is now read under the new
 * content type. On the very first read after the deploy (no `speaker_list`
 * row yet), seed the new row from the sibling legacy row's enabled/style/
 * filters when one exists, instead of the plain defaults every other content
 * type gets on first read.
 */
export async function getOrCreateSpeakerListConfigIn(dbOrTx: DbOrTx, eventId: EventId): Promise<EmbedConfigDTO> {
  const existing = await findRow(dbOrTx, eventId, "speaker_list");
  if (existing) return toDto(existing);
  const legacy = await findRow(dbOrTx, eventId, "speaker_gallery");
  await dbOrTx
    .insert(embeds)
    .values({
      eventId,
      contentType: "speaker_list",
      name: DEFAULT_EMBED_NAME.speaker_list,
      enabled: legacy?.enabled ?? true,
      style: legacy?.style ?? {},
      filters: legacy?.filters ?? {},
    });
  // Same re-read as above, for the same reason.
  const inserted = await findRow(dbOrTx, eventId, "speaker_list");
  if (!inserted) throw new AppError("INTERNAL", "Could not create the embed config");
  return toDto(inserted);
}
export const getOrCreateSpeakerListConfig = (eventId: EventId): Promise<EmbedConfigDTO> =>
  getOrCreateSpeakerListConfigIn(db, eventId);

/** All five canonical configs for the admin panel, creating any that are missing. */
export async function listEmbedConfigsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<EmbedConfigDTO[]> {
  const configs: EmbedConfigDTO[] = [];
  for (const contentType of CANONICAL_EMBED_TYPES) {
    configs.push(contentType === "speaker_list"
      ? await getOrCreateSpeakerListConfigIn(dbOrTx, eventId)
      : await getOrCreateEmbedConfigIn(dbOrTx, eventId, contentType));
  }
  return configs;
}
export const listEmbedConfigs = (eventId: EventId): Promise<EmbedConfigDTO[]> => listEmbedConfigsIn(db, eventId);
