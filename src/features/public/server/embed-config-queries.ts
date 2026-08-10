import { and, asc, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { embeds } from "@/db/schema";
import { AppError } from "@/shared/lib/errors";
import {
  CANONICAL_EMBED_TYPES,
  embedConfigDtoSchema,
  embedStyleSchema,
  type CanonicalEmbedContentType,
  type EmbedConfigDTO,
  type EventId,
} from "../embed-config-types";

/**
 * Embed kill-switch + appearance reads/writes over the `embeds` table — see
 * the M33 work order's Provides section. `embeds` has no unique constraint on
 * `(event_id, content_type)` (it is a general multi-type table); this module
 * only ever touches the two canonical types above.
 */

const DEFAULT_EMBED_NAME: Record<CanonicalEmbedContentType, string> = {
  schedule_itinerary: "Schedule itinerary",
  speaker_gallery: "Speaker gallery",
};

function toDto(row: typeof embeds.$inferSelect): EmbedConfigDTO {
  return embedConfigDtoSchema.parse({
    id: row.id,
    eventId: row.eventId,
    contentType: row.contentType,
    enabled: row.enabled,
    style: embedStyleSchema.parse(row.style ?? {}),
  });
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
 * Absence of a row means "never configured, still enabled" — the public
 * embed routes must serve before any admin ever visits the embeds settings
 * page. This is the gate the bare-shell pages call before fetching any
 * published data, never after.
 */
export async function isEmbedEnabledIn(dbOrTx: DbOrTx, eventId: EventId, contentType: CanonicalEmbedContentType): Promise<boolean> {
  const row = await findRow(dbOrTx, eventId, contentType);
  return row?.enabled ?? true;
}
export const isEmbedEnabled = (eventId: EventId, contentType: CanonicalEmbedContentType): Promise<boolean> =>
  isEmbedEnabledIn(db, eventId, contentType);

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
  const [inserted] = await dbOrTx
    .insert(embeds)
    .values({ eventId, contentType, name: DEFAULT_EMBED_NAME[contentType], enabled: true, style: {} })
    .returning();
  if (!inserted) throw new AppError("INTERNAL", "Could not create the embed config");
  return toDto(inserted);
}
export const getOrCreateEmbedConfig = (eventId: EventId, contentType: CanonicalEmbedContentType): Promise<EmbedConfigDTO> =>
  getOrCreateEmbedConfigIn(db, eventId, contentType);

/** Both canonical configs for the admin panel, creating either that is missing. */
export async function listEmbedConfigsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<EmbedConfigDTO[]> {
  const configs: EmbedConfigDTO[] = [];
  for (const contentType of CANONICAL_EMBED_TYPES) configs.push(await getOrCreateEmbedConfigIn(dbOrTx, eventId, contentType));
  return configs;
}
export const listEmbedConfigs = (eventId: EventId): Promise<EmbedConfigDTO[]> => listEmbedConfigsIn(db, eventId);
