import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import type { EventId } from "@/shared/contracts";

/**
 * The list-row shape — never carries `bodyHtml` (the admin table and the
 * portal list both only ever need title/slug/publish/order metadata; shipping
 * the sanitized body to a list view is pure waste). `summary` is a plaintext
 * excerpt computed once at save time (`mutations.ts`'s `excerptFromHtml`), not
 * re-derived from `bodyHtml` on every list read.
 */
export type ResourcePageRow = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  published: boolean;
  sortOrder: number;
  updatedAt: string;
};

export type ResourcePageDTO = ResourcePageRow & { bodyHtml: string | null };

type Row = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  published: boolean;
  sort_order: number;
  updated_at: string;
};
type RowWithBody = Row & { body_html: string | null };

function toRow(row: Row): ResourcePageRow {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    published: row.published,
    sortOrder: Number(row.sort_order),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toDto(row: RowWithBody): ResourcePageDTO {
  return { ...toRow(row), bodyHtml: row.body_html };
}

/**
 * Ordered `sort_order, title` per the work order. `publishedOnly` is enforced
 * here, server-side — the portal list route passes it, never a client filter
 * (R4/leakage-safety: an unpublished row must never leave the server at all).
 */
export async function listResourcePagesIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  opts: { publishedOnly?: boolean } = {},
): Promise<ResourcePageRow[]> {
  const publishedOnly = opts.publishedOnly ?? false;
  const result = await dbOrTx.execute<Row>(sql`
    SELECT id, title, slug, summary, published, sort_order, updated_at
    FROM resource_pages
    WHERE event_id = ${eventId}
      AND (${publishedOnly}::boolean = false OR published = true)
    ORDER BY sort_order, title
  `);
  return (result.rows ?? []).map(toRow);
}

/**
 * By slug, `(eventId, slug)`-scoped (the table's own unique key), so a slug
 * that exists in another event never resolves here — cross-event isolation is
 * structural, not a filter that could be forgotten. `publishedOnly` returns
 * `null` for a draft exactly like a slug that does not exist at all: the
 * portal page turns either into the same 404, never a 403 that would confirm
 * the page's existence to somebody who should not see it.
 */
export async function getResourcePageIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  slug: string,
  opts: { publishedOnly?: boolean } = {},
): Promise<ResourcePageDTO | null> {
  const publishedOnly = opts.publishedOnly ?? false;
  const result = await dbOrTx.execute<RowWithBody>(sql`
    SELECT id, title, slug, summary, published, sort_order, updated_at, body_html
    FROM resource_pages
    WHERE event_id = ${eventId} AND slug = ${slug}
      AND (${publishedOnly}::boolean = false OR published = true)
    LIMIT 1
  `);
  const row = (result.rows ?? [])[0];
  return row ? toDto(row) : null;
}

/** By id — what the admin editor loads to prefill a save. Never published-gated: an organizer can open a draft. */
export async function getResourcePageByIdIn(dbOrTx: DbOrTx, eventId: EventId, id: string): Promise<ResourcePageDTO | null> {
  const result = await dbOrTx.execute<RowWithBody>(sql`
    SELECT id, title, slug, summary, published, sort_order, updated_at, body_html
    FROM resource_pages WHERE id = ${id} AND event_id = ${eventId}
  `);
  const row = (result.rows ?? [])[0];
  return row ? toDto(row) : null;
}

export const listResourcePages = (eventId: EventId, opts?: { publishedOnly?: boolean }): Promise<ResourcePageRow[]> =>
  listResourcePagesIn(db, eventId, opts);
export const getResourcePage = (eventId: EventId, slug: string, opts?: { publishedOnly?: boolean }): Promise<ResourcePageDTO | null> =>
  getResourcePageIn(db, eventId, slug, opts);
export const getResourcePageById = (eventId: EventId, id: string): Promise<ResourcePageDTO | null> =>
  getResourcePageByIdIn(db, eventId, id);
