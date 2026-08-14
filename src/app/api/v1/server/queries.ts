import { sql } from "drizzle-orm";
import { activePlanIdSql, formatCode } from "@/features/submissions";
import { db, type DbOrTx } from "@/db/client";
import type { CommLogRow, EventId, SubmissionKind, SubmissionStatus } from "@/shared/contracts";

/**
 * The reads behind the four keyed `/api/v1` endpoints. Every one of them is a
 * thin wrapper over an already-sanctioned read path (a reporting view, or a
 * feature's own tested query) except `/submissions`, whose public DTO and
 * cursor pagination are this module's own contract — the one direct read the
 * work order allows, same as `/schedule` and `/speakers` next to it.
 */

// ---- /submissions ----------------------------------------------------------

export type PublicSubmissionRow = {
  code: string;
  title: string;
  status: Exclude<SubmissionStatus, "draft">;
  kind: SubmissionKind;
  track: string | null;
  tags: string[];
  submitterEmail: string | null;
  speakers: string[];
  submittedAt: string | null;
  notifiedAt: string | null;
  rating: number | null;
};

export type PublicSubmissionFilters = {
  status?: Exclude<SubmissionStatus, "draft">;
  limit: number;
  cursorCode: number | null;
};

type SubmissionQueryRow = {
  code: number;
  title: string;
  status: Exclude<SubmissionStatus, "draft">;
  kind: SubmissionKind;
  track_name: string | null;
  submitter_email: string | null;
  speakers: string[] | null;
  tags: string[] | null;
  submitted_at: string | null;
  notified_at: string | null;
  rating: number | null;
};

/**
 * Drafts are excluded unconditionally (`s.status <> 'draft'`), independent of
 * whatever `status` the caller passed — the draft-leak guard applies even
 * when no filter is given, per the work order. The public code remains the
 * cursor token for compatibility, but resolves to the durable creation tuple;
 * randomized codes have no ordering semantics.
 */
export async function listPublicSubmissionsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  filters: PublicSubmissionFilters,
): Promise<{ rows: PublicSubmissionRow[]; nextCursor: string | null }> {
  const result = await dbOrTx.execute<SubmissionQueryRow>(sql`
    SELECT s.code, s.title, s.status, s.kind, t.name AS track_name, sc.email AS submitter_email,
      COALESCE((
        SELECT json_agg(btrim(c.first_name || ' ' || c.last_name) ORDER BY sp.is_primary DESC, sp.sort_order)
        FROM submission_participants sp
        JOIN contacts c ON c.id = sp.contact_id AND c.event_id = sp.event_id
        WHERE sp.submission_id = s.id AND sp.event_id = s.event_id
      ), '[]'::json) AS speakers,
      COALESCE((
        SELECT json_agg(tg.name ORDER BY tg.name)
        FROM submission_tags st
        JOIN tags tg ON tg.id = st.tag_id AND tg.event_id = st.event_id
        WHERE st.submission_id = s.id AND st.event_id = s.event_id
      ), '[]'::json) AS tags,
      s.submitted_at, s.notified_at, r.rating
    FROM submissions s
    LEFT JOIN tracks t ON t.id = s.track_id AND t.event_id = s.event_id
    LEFT JOIN contacts sc ON sc.id = s.submitter_contact_id AND sc.event_id = s.event_id
    LEFT JOIN LATERAL (
      SELECT v.rating FROM submission_ratings_v v
      WHERE v.submission_id = s.id AND v.event_id = s.event_id AND v.plan_id = ${activePlanIdSql(eventId)}
    ) r ON TRUE
    WHERE s.event_id = ${eventId} AND s.status <> 'draft'
      ${filters.status ? sql`AND s.status = ${filters.status}` : sql``}
      ${filters.cursorCode !== null ? sql`AND (s.created_at, s.id) > (
        SELECT cursor_row.created_at, cursor_row.id
        FROM submissions cursor_row
        WHERE cursor_row.event_id = ${eventId} AND cursor_row.code = ${filters.cursorCode}
      )` : sql``}
    ORDER BY s.created_at ASC, s.id ASC
    LIMIT ${filters.limit + 1}
  `);

  const rows = result.rows ?? [];
  const hasMore = rows.length > filters.limit;
  const page = hasMore ? rows.slice(0, filters.limit) : rows;
  const lastCode = page[page.length - 1]?.code;
  const nextCursor = hasMore && lastCode !== undefined ? String(lastCode) : null;

  return {
    rows: page.map((row) => ({
      code: formatCode(row.code),
      title: row.title,
      status: row.status,
      kind: row.kind,
      track: row.track_name,
      tags: row.tags ?? [],
      submitterEmail: row.submitter_email,
      speakers: row.speakers ?? [],
      submittedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : null,
      notifiedAt: row.notified_at ? new Date(row.notified_at).toISOString() : null,
      rating: row.rating === null ? null : Number(row.rating),
    })),
    nextCursor,
  };
}

export function listPublicSubmissions(eventId: EventId, filters: PublicSubmissionFilters) {
  return listPublicSubmissionsIn(db, eventId, filters);
}

// ---- /speakers/outstanding-tasks -------------------------------------------

export type OutstandingTaskRow = {
  contactId: string;
  name: string;
  email: string;
  openCount: number;
  overdueCount: number;
};

/**
 * The same `speaker_outstanding_v` view the dashboard's Speaker Tracking panel
 * and the portal's task counts read — so this number can never quietly drift
 * from what an organizer sees in the admin.
 */
export async function listOutstandingTasksIn(dbOrTx: DbOrTx, eventId: EventId): Promise<OutstandingTaskRow[]> {
  const result = await dbOrTx.execute<{ contact_id: string; name: string; email: string; open_count: number; overdue_count: number }>(sql`
    SELECT o.contact_id,
      coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Unnamed speaker') AS name,
      c.email, o.open_count, o.overdue_count
    FROM speaker_outstanding_v o
    JOIN contacts c ON c.id = o.contact_id AND c.event_id = o.event_id
    WHERE o.event_id = ${eventId} AND o.open_count > 0
    ORDER BY o.open_count DESC, o.overdue_count DESC, name, o.contact_id
  `);
  return (result.rows ?? []).map((row) => ({
    contactId: row.contact_id,
    name: row.name,
    email: row.email,
    openCount: Number(row.open_count),
    overdueCount: Number(row.overdue_count),
  }));
}

export function listOutstandingTasks(eventId: EventId) {
  return listOutstandingTasksIn(db, eventId);
}

// ---- /stats -----------------------------------------------------------------

/**
 * The exact `DashboardOverview` M38 computes, minus the UI-only fields
 * (`attention` hrefs point at admin routes a keyed caller cannot reach;
 * `recentSubmissions` duplicates `/submissions`). Zero second implementation
 * of any counting rule — this is field selection, not a new query.
 */
export function toPublicStats<T extends { kpis: unknown; statusCounts: unknown; speakerTracking: unknown }>(
  overview: T,
): { kpis: T["kpis"]; statusCounts: T["statusCounts"]; speakerTracking: T["speakerTracking"] } {
  return { kpis: overview.kpis, statusCounts: overview.statusCounts, speakerTracking: overview.speakerTracking };
}

// ---- /comms-log ---------------------------------------------------------------

/**
 * `CommLogRow` (M34) already excludes the rendered body; this additionally
 * drops `subjectRendered` and every internal id `/comms-log` has no business
 * publishing, since a rendered subject line can itself carry a live magic
 * link (e.g. `portal_login`).
 */
export function toPublicCommLogRow(row: CommLogRow) {
  return {
    recipient: { name: row.recipientName, email: row.recipientEmail },
    templateKey: row.templateKey,
    status: row.status,
    providerMessageId: row.providerMessageId,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
  };
}
