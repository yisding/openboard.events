import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { embeds } from "@/db/schema";
import { AppError } from "@/shared/lib/errors";
import {
  canonicalEmbedContentTypeSchema,
  embedConfigDtoSchema,
  embedConfigPatchSchema,
  embedFiltersSchema,
  embedStyleSchema,
  type EmbedConfigDTO,
  type EmbedConfigPatch,
  type EmbedId,
  type EventId,
} from "../embed-config-types";

/**
 * Plain guarded-by-id `UPDATE ... WHERE id = $embedId AND event_id = $eventId
 * RETURNING *` — no CAS/`row_version` needed (`embeds` has none, and this is
 * a low-contention single-owner settings surface; the R11 "simple row saves
 * may last-write-wins" exception applies per the M33 work order).
 */
export async function updateEmbedConfigIn(dbOrTx: DbOrTx, eventId: EventId, embedId: EmbedId, patch: EmbedConfigPatch): Promise<EmbedConfigDTO> {
  const strict = embedConfigPatchSchema.parse(patch);
  const values: Partial<typeof embeds.$inferInsert> = { updatedAt: new Date() };
  if (strict.enabled !== undefined) values.enabled = strict.enabled;
  if (strict.style !== undefined) values.style = strict.style;
  if (strict.filters !== undefined) values.filters = strict.filters;

  const [row] = await dbOrTx
    .update(embeds)
    .set(values)
    .where(and(eq(embeds.id, embedId), eq(embeds.eventId, eventId)))
    .returning();
  if (!row) throw new AppError("NOT_FOUND", "That embed config no longer exists");
  const contentType = canonicalEmbedContentTypeSchema.safeParse(row.contentType);
  if (!contentType.success) throw new AppError("NOT_FOUND", "That embed config no longer exists");
  return embedConfigDtoSchema.parse({
    id: row.id,
    eventId: row.eventId,
    contentType: contentType.data,
    enabled: row.enabled,
    style: embedStyleSchema.parse(row.style ?? {}),
    filters: embedFiltersSchema.parse(row.filters ?? {}),
  });
}
export const updateEmbedConfig = (eventId: EventId, embedId: EmbedId, patch: EmbedConfigPatch): Promise<EmbedConfigDTO> =>
  updateEmbedConfigIn(db, eventId, embedId, patch);
