import { sql, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db/client";
import type { EventId } from "@/shared/contracts";

/**
 * M58 — the command palette's entity jump. One query per entity type rather
 * than a hand-rolled `UNION` across three unrelated shapes (submission code,
 * contact name, session title) — each stays a plain, indexable `WHERE`, and a
 * caller who only wants one type (none do yet, but the shape invites it) can
 * call it directly.
 */
export type SearchResultType = "submission" | "speaker" | "session";

export type SearchResult = {
  type: SearchResultType;
  id: string;
  /** The primary line — a title, a name. */
  label: string;
  /** The secondary line — a code, an email, a status. Never required. */
  sublabel: string | null;
  href: string;
};

// A plain, non-generic `execute` — matching `nav-counts.ts`'s `NavCountsDb` —
// rather than the app's concrete `DbOrTx` (Neon-only): the latter's generic
// `execute<T>` does not structurally match `drizzle-orm/pglite`'s, which is
// what this module's own PGlite test passes in.
export type SearchDb = {
  execute(query: SQLWrapper | string): PromiseLike<{ rows: Record<string, unknown>[] }>;
};

/** Results per type, before the three lists are interleaved and capped. */
const PER_TYPE_LIMIT = 5;
/** Total rows returned to the palette, so a broad query never renders a page-length dropdown. */
const TOTAL_LIMIT = 10;

type SubmissionRow = { id: string; code: number; title: string; status: string };
type ContactRow = { id: string; firstName: string; lastName: string; email: string };
type SessionRow = { id: string; title: string; status: string };

function submissionResult(eventId: EventId, row: SubmissionRow): SearchResult {
  return {
    type: "submission",
    id: row.id,
    label: row.title || `SESS-${row.code}`,
    sublabel: `SESS-${row.code} · ${row.status.replace(/_/g, " ")}`,
    // The abstracts list reads `submission` as a one-shot "open this drawer"
    // param — the same one `SpeakerFlowDrawer`'s own cross-links already send.
    href: `/events/${eventId}/abstracts?submission=${row.id}`,
  };
}

function speakerName(row: ContactRow): string {
  const name = `${row.firstName} ${row.lastName}`.trim();
  return name || row.email;
}

function speakerResult(eventId: EventId, row: ContactRow): SearchResult {
  return {
    type: "speaker",
    id: row.id,
    label: speakerName(row),
    sublabel: row.email,
    // Straight to the full profile, not the list's flow-drawer: the drawer
    // renders from a list row already in memory, and a jump target found by
    // search is very often on a different filter/page than the one open.
    href: `/events/${eventId}/speakers/${row.id}`,
  };
}

function sessionResult(eventId: EventId, row: SessionRow): SearchResult {
  return {
    type: "session",
    id: row.id,
    label: row.title,
    sublabel: row.status.replace(/_/g, " "),
    href: `/events/${eventId}/agenda?view=list&session=${row.id}`,
  };
}

export async function searchEventEntitiesIn(dbOrTx: SearchDb, eventId: EventId, rawQuery: string): Promise<SearchResult[]> {
  const query = rawQuery.trim();
  if (query.length < 2) return [];
  const term = `%${query.toLowerCase()}%`;
  // A bare number is almost always a submission code — "12" should find
  // SESS-12 even though "12" is nowhere in the title.
  const codeMatch = /^\d+$/.test(query) ? Number(query) : null;

  const [submissionRows, contactRows, sessionRows] = await Promise.all([
    dbOrTx.execute(sql`
      SELECT id::text AS id, code, title, status
      FROM submissions
      WHERE event_id = ${eventId} AND status <> 'draft'
        AND (lower(title) LIKE ${term} OR code = ${codeMatch})
      ORDER BY (code = ${codeMatch}) DESC, submitted_at DESC NULLS LAST
      LIMIT ${PER_TYPE_LIMIT}
    `),
    dbOrTx.execute(sql`
      SELECT id::text AS id, first_name AS "firstName", last_name AS "lastName", email
      FROM contacts
      WHERE event_id = ${eventId}
        AND lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || email) LIKE ${term}
      ORDER BY last_name ASC, first_name ASC
      LIMIT ${PER_TYPE_LIMIT}
    `),
    dbOrTx.execute(sql`
      SELECT id::text AS id, title, status
      FROM sessions
      WHERE event_id = ${eventId} AND lower(title) LIKE ${term}
      ORDER BY title ASC
      LIMIT ${PER_TYPE_LIMIT}
    `),
  ]);

  // Submissions first (code jumps are the most common "I know exactly what
  // I'm looking for" search), then speakers, then sessions — a stable order
  // so the palette's list never reshuffles between keystrokes for the same
  // relative ranking.
  const results = [
    ...(submissionRows.rows as SubmissionRow[]).map((row) => submissionResult(eventId, row)),
    ...(contactRows.rows as ContactRow[]).map((row) => speakerResult(eventId, row)),
    ...(sessionRows.rows as SessionRow[]).map((row) => sessionResult(eventId, row)),
  ];
  return results.slice(0, TOTAL_LIMIT);
}

export const searchEventEntities = (eventId: EventId, query: string) => searchEventEntitiesIn(db, eventId, query);
