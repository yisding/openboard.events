import { sql } from "drizzle-orm";
import { parseTag } from "xss";
import { z } from "zod";
import { db, type DbOrTx } from "@/db/client";
import type { EventId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { sanitize } from "@/shared/lib/sanitize";
import { RESERVED_SLUGS, slugify } from "@/shared/lib/slug";

const SLUG_PATTERN = /^[a-z0-9](-?[a-z0-9])*$/;
// PG's default constraint name for an unnamed multi-column UNIQUE, mirroring
// `events.ts`'s `EVENTS_SLUG_UNIQUE` — see `drizzle/0000_init.sql`'s
// `UNIQUE (event_id,slug)` on `resource_pages`.
const RESOURCE_SLUG_UNIQUE = "resource_pages_event_id_slug_key";

/**
 * Drizzle wraps the driver's error in one of its own and keeps the original as
 * `cause`, so the constraint name is a level or two down. Local copy of
 * `features/events/server/db-errors.ts`'s helper — that file belongs to
 * another feature, and this module owns no cross-feature import of it.
 */
function isConstraintViolation(error: unknown, constraintName: string): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    const entry = current as { message?: unknown; constraint?: unknown; cause?: unknown };
    if (entry.constraint === constraintName) return true;
    if (typeof entry.message === "string" && entry.message.includes(constraintName)) return true;
    current = entry.cause;
  }
  return false;
}

function assertValidSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new AppError("VALIDATION", "URL must be lowercase letters, numbers and single hyphens", {
      fieldErrors: { slug: "Use lowercase letters, numbers and hyphens" },
    });
  }
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) {
    throw new AppError("VALIDATION", `“${slug}” is a reserved word and cannot be used as a URL`, {
      fieldErrors: { slug: "That word is reserved" },
    });
  }
}

/**
 * The plaintext excerpt the admin list and the portal cards show — same
 * `parseTag` idiom the frozen `plainTextLength` contract helper uses, just
 * collecting the text instead of counting it. Computed once here, at save
 * time, off the **sanitized** HTML, so a stripped `<script>` never leaks its
 * text content into the excerpt either.
 *
 * A space precedes every `<` first: `parseTag` concatenates text nodes with
 * nothing between them, so "<h2>Welcome</h2><p>Check in…" would otherwise
 * collapse into "WelcomeCheck in…" with no word boundary at all.
 */
export function excerptFromHtml(html: string, max = 140): string {
  const text = (parseTag(html.replace(/</g, " <"), () => "", (value) => value) as string).replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export const saveResourcePageInputSchema = z.object({
  id: z.uuid().optional(),
  title: z.string().trim().min(1).max(255),
  slug: z.string().trim().toLowerCase().max(255).optional(),
  bodyHtml: z.string().max(200_000).default(""),
  published: z.boolean().default(true),
  sortOrder: z.number().int().min(0).optional(),
});
export type SaveResourcePageInput = z.infer<typeof saveResourcePageInputSchema>;
/** Named to match the work order's Provides block; identical shape to `SaveResourcePageInput`. */
export type ResourcePageInput = SaveResourcePageInput;
export const createResourcePageRequestSchema = saveResourcePageInputSchema;

/**
 * What the API routes actually accept: the save input plus R11's stale-write
 * token, riding alongside rather than nested — the route layer's job is to
 * split it back into `saveResourcePageIn`'s two arguments before this module
 * ever sees a raw request body.
 */
export const saveResourcePageRequestSchema = saveResourcePageInputSchema.extend({
  expectedUpdatedAt: z.string().optional(),
});
export type SaveResourcePageRequest = z.infer<typeof saveResourcePageRequestSchema>;

/** Collection-create semantics. When `id` is supplied it is a durable request
 * key: the first POST inserts it, and every replay returns that same page
 * without rewriting it. */
export async function createResourcePageIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: SaveResourcePageInput,
): Promise<{ pageId: string }> {
  if (input.id) {
    const existing = await dbOrTx.execute<{ id: string }>(sql`
      SELECT id FROM resource_pages WHERE id = ${input.id} AND event_id = ${eventId}
    `);
    const row = (existing.rows ?? [])[0];
    if (row) return { pageId: row.id };
  }

  const slug = slugify((input.slug?.trim() || input.title));
  assertValidSlug(slug);
  const bodyHtml = sanitize(input.bodyHtml ?? "", { profile: "wide" });
  const summary = excerptFromHtml(bodyHtml);
  try {
    const result = await dbOrTx.execute<{ id: string }>(sql`
      INSERT INTO resource_pages (id, event_id, title, slug, summary, body_html, published, sort_order)
      VALUES (
        COALESCE(${input.id ?? null}::uuid, gen_random_uuid()), ${eventId}, ${input.title}, ${slug}, ${summary}, ${bodyHtml}, ${input.published},
        COALESCE(${input.sortOrder ?? null}::int, (SELECT coalesce(max(sort_order) + 1, 0) FROM resource_pages WHERE event_id = ${eventId}))
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING id
    `);
    const row = (result.rows ?? [])[0];
    if (row) return { pageId: row.id };

    // A concurrent replay may win after the pre-read but before the INSERT.
    const recovered = await dbOrTx.execute<{ id: string }>(sql`
      SELECT id FROM resource_pages WHERE id = ${input.id ?? null}::uuid AND event_id = ${eventId}
    `);
    const recoveredRow = (recovered.rows ?? [])[0];
    if (recoveredRow) return { pageId: recoveredRow.id };
    throw new AppError("NOT_FOUND", "Resource page not found");
  } catch (error) {
    if (isConstraintViolation(error, RESOURCE_SLUG_UNIQUE)) {
      throw new AppError("VALIDATION", "That URL is already used", { fieldErrors: { slug: "That URL is already used" } });
    }
    throw error;
  }
}

/**
 * Create or update in one statement — not one of the eight audited `withTx`
 * paths (driver resolution #4). `bodyHtml` goes through `sanitize(html,
 * {profile:'wide'})` here on save, and again in `<RichTextView wide>` on every
 * render (the work order's "sanitize twice" guardrail) — this call is belt,
 * the render call is braces.
 *
 * `expectedUpdatedAt`, when given, is compared with millisecond precision on
 * both sides (`date_trunc('milliseconds', …)`): Postgres timestamps carry
 * microseconds but the DTO's `updatedAt` is a JS `Date#toISOString()` round
 * trip, which only has millisecond resolution. Comparing the raw columns would
 * report every untouched save as stale.
 */
export async function saveResourcePageIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  input: SaveResourcePageInput,
  expectedUpdatedAt?: string,
): Promise<{ pageId: string }> {
  if (!input.id) return createResourcePageIn(dbOrTx, eventId, input);
  const slug = slugify((input.slug?.trim() || input.title));
  assertValidSlug(slug);
  const bodyHtml = sanitize(input.bodyHtml ?? "", { profile: "wide" });
  const summary = excerptFromHtml(bodyHtml);

  try {
    const staleGuard = expectedUpdatedAt
      ? sql`AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${expectedUpdatedAt}::timestamptz)`
      : sql.empty();
    const result = await dbOrTx.execute<{ id: string }>(sql`
      UPDATE resource_pages
      SET title = ${input.title}, slug = ${slug}, summary = ${summary}, body_html = ${bodyHtml},
          published = ${input.published}, updated_at = now()
      WHERE id = ${input.id} AND event_id = ${eventId} ${staleGuard}
      RETURNING id
    `);
    const row = (result.rows ?? [])[0];
    if (row) return { pageId: row.id };

    const existing = await dbOrTx.execute<{ id: string }>(sql`
      SELECT id FROM resource_pages WHERE id = ${input.id} AND event_id = ${eventId}
    `);
    if ((existing.rows ?? []).length === 0) throw new AppError("NOT_FOUND", "Resource page not found");
    throw new AppError("STALE_WRITE", "This page changed since you opened it");
  } catch (error) {
    if (isConstraintViolation(error, RESOURCE_SLUG_UNIQUE)) {
      throw new AppError("VALIDATION", "That URL is already used", { fieldErrors: { slug: "That URL is already used" } });
    }
    throw error;
  }
}

export async function deleteResourcePageIn(dbOrTx: DbOrTx, eventId: EventId, pageId: string): Promise<void> {
  const result = await dbOrTx.execute<{ id: string }>(sql`
    DELETE FROM resource_pages WHERE id = ${pageId} AND event_id = ${eventId} RETURNING id
  `);
  if ((result.rows ?? []).length === 0) throw new AppError("NOT_FOUND", "Resource page not found");
}

/**
 * Renumbers the whole list in one statement — no fractional keys, matching
 * `features/events/server/vocab.ts`'s `reorderVocabIn`. `orderedIds` must be
 * exactly the event's current id set, once each, or nothing is written.
 */
export const reorderResourcePagesInputSchema = z.object({ orderedIds: z.array(z.uuid()).min(1) });

export async function reorderResourcePagesIn(dbOrTx: DbOrTx, eventId: EventId, orderedIds: string[]): Promise<void> {
  const current = await dbOrTx.execute<{ id: string }>(sql`SELECT id FROM resource_pages WHERE event_id = ${eventId}`);
  const currentIds = new Set((current.rows ?? []).map((row) => row.id));
  const requestedIds = new Set(orderedIds);
  if (orderedIds.length !== currentIds.size || requestedIds.size !== orderedIds.length || [...currentIds].some((id) => !requestedIds.has(id))) {
    throw new AppError("VALIDATION", "orderedIds must contain exactly the current set of ids, once each");
  }
  const values = orderedIds.map((id, index) => sql`(${id}::uuid, ${index}::int)`);
  await dbOrTx.execute(sql`
    UPDATE resource_pages AS t SET sort_order = v.ord, updated_at = now()
    FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, ord)
    WHERE t.id = v.id AND t.event_id = ${eventId}
  `);
}

export const saveResourcePage = (
  eventId: EventId,
  input: SaveResourcePageInput,
  expectedUpdatedAt?: string,
): Promise<{ pageId: string }> => saveResourcePageIn(db, eventId, input, expectedUpdatedAt);
export const createResourcePage = (eventId: EventId, input: SaveResourcePageInput): Promise<{ pageId: string }> =>
  createResourcePageIn(db, eventId, input);
export const deleteResourcePage = (eventId: EventId, pageId: string): Promise<void> => deleteResourcePageIn(db, eventId, pageId);
export const reorderResourcePages = (eventId: EventId, orderedIds: string[]): Promise<void> =>
  reorderResourcePagesIn(db, eventId, orderedIds);
