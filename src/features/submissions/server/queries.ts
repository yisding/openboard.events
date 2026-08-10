import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import {
  answerPanelDataSchema,
  formSnapshotSchema,
  submissionListRowSchema,
  type EventId,
  type SubmissionDetailDTO,
  type SubmissionId,
  type SubmissionListRow,
  type SubmissionStatus,
} from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { activePlanIdSql } from "../evaluation/server/queries";
import type { SubmissionFilters } from "./filters";

/**
 * The Abstracts table's reads. Every query is event-scoped and every one of them
 * goes through the same WHERE clause, so the tab counts and the rows in the tab
 * can never disagree — the bug that makes an organizer refresh the page to find
 * out which number lied.
 */

/** Strips markup for the list's preview column; the detail view renders the HTML. */
const DESCRIPTION_PLAIN = sql`nullif(btrim(regexp_replace(coalesce(s.description_html, ''), '<[^>]*>', ' ', 'g')), '')`;

function whereClause(
  eventId: EventId,
  filters: Omit<SubmissionFilters, "page" | "pageSize" | "sort">,
  includeStatus = true,
  submissionId?: SubmissionId,
) {
  const clauses = [sql`s.event_id = ${eventId}`];
  if (submissionId) clauses.push(sql`s.id = ${submissionId}`);
  if (includeStatus && filters.status !== "all") clauses.push(sql`s.status = ${filters.status}`);
  if (filters.trackId) clauses.push(sql`s.track_id = ${filters.trackId}`);
  if (filters.tagId) {
    clauses.push(sql`EXISTS (SELECT 1 FROM submission_tags st WHERE st.submission_id = s.id AND st.tag_id = ${filters.tagId})`);
  }
  if (filters.search) {
    // Code, title and speaker name are the three things an organizer types into
    // a search box; matching only the title makes the box feel broken.
    const like = `%${filters.search.toLowerCase()}%`;
    clauses.push(sql`(
      lower(s.title) LIKE ${like}
      OR s.code::text LIKE ${like}
      OR EXISTS (
        SELECT 1 FROM submission_participants sp
        JOIN contacts c ON c.id = sp.contact_id AND c.event_id = sp.event_id
        WHERE sp.submission_id = s.id AND lower(c.first_name || ' ' || c.last_name || ' ' || c.email) LIKE ${like}
      )
    )`);
  }
  return sql.join(clauses, sql` AND `);
}

const ORDER_BY = {
  newest: sql`s.submitted_at DESC NULLS LAST, s.created_at DESC, s.code ASC`,
  oldest: sql`s.submitted_at ASC NULLS LAST, s.created_at ASC, s.code ASC`,
  code: sql`s.code ASC`,
  code_desc: sql`s.code DESC`,
  title: sql`lower(s.title) ASC, s.code ASC`,
  title_desc: sql`lower(s.title) DESC, s.code ASC`,
  rating: sql`r.rating DESC NULLS LAST, s.code ASC`,
  rating_asc: sql`r.rating ASC NULLS LAST, s.code ASC`,
} as const;

type ListRowShape = Omit<SubmissionListRow, "speakers" | "tags"> & {
  speakers: SubmissionListRow["speakers"] | null;
  tags: SubmissionListRow["tags"] | null;
};

const ALL_FILTERS: SubmissionFilters = {
  status: "all", search: "", trackId: null, tagId: null, page: 1, pageSize: 1, sort: "newest",
};

async function selectRows(
  dbOrTx: DbOrTx,
  eventId: EventId,
  where: ReturnType<typeof whereClause>,
  order: (typeof ORDER_BY)[keyof typeof ORDER_BY],
  limit: number,
  offset: number,
): Promise<Array<ListRowShape & { total: number }>> {

  const result = await dbOrTx.execute<ListRowShape & { total: number }>(sql`
    SELECT
      s.id AS "submissionId", s.code, s.status, s.source, s.form_id AS "formId",
      f.internal_name AS "formName", s.title,
      ${DESCRIPTION_PLAIN} AS "descriptionPlain",
      sc.email AS "submitterEmail",
      nullif(btrim(coalesce(sc.first_name, '') || ' ' || coalesce(sc.last_name, '')), '') AS "submitterName",
      COALESCE((
        SELECT json_agg(json_build_object('contactId', c.id, 'name', btrim(c.first_name || ' ' || c.last_name), 'isPrimary', sp.is_primary)
                        ORDER BY sp.is_primary DESC, sp.sort_order)
        FROM submission_participants sp
        JOIN contacts c ON c.id = sp.contact_id AND c.event_id = sp.event_id
        WHERE sp.submission_id = s.id
      ), '[]'::json) AS speakers,
      s.track_id AS "trackId", t.name AS "trackName", t.color AS "trackColor",
      COALESCE((
        SELECT json_agg(json_build_object('id', tg.id, 'name', tg.name) ORDER BY tg.name)
        FROM submission_tags st JOIN tags tg ON tg.id = st.tag_id
        WHERE st.submission_id = s.id
      ), '[]'::json) AS tags,
      r.rating, COALESCE(r.n_scores, 0) AS "nScores",
      s.notified_at AS "notifiedAt", s.submitted_at AS "submittedAt", s.created_at AS "createdAt",
      sf.name AS "formatName", s.language, s.level, s.capacity, s.client_session_id AS "clientSessionId",
      s.row_version AS "rowVersion",
      count(*) OVER () ::int AS total
    FROM submissions s
    LEFT JOIN forms f ON f.id = s.form_id
    LEFT JOIN contacts sc ON sc.id = s.submitter_contact_id AND sc.event_id = s.event_id
    LEFT JOIN tracks t ON t.id = s.track_id
    LEFT JOIN session_formats sf ON sf.id = s.format_id
    LEFT JOIN LATERAL (
      -- submission_ratings_v is one row per (submission, plan). Joining it
      -- directly multiplies a submission that has reviews in two plans, which
      -- shows the same abstract twice in the table and doubles the tab count.
      -- Scoping to the active round also keeps the number meaningful: Round 1
      -- and Round 2 are independent verdicts, and their mean is a score no
      -- reviewer ever gave.
      SELECT v.rating, v.n_scores
      FROM submission_ratings_v v
      WHERE v.submission_id = s.id AND v.event_id = s.event_id
        AND v.plan_id = ${activePlanIdSql(eventId)}
    ) r ON TRUE
    WHERE ${where}
    ORDER BY ${order}
    LIMIT ${limit} OFFSET ${offset}
  `);
  return result.rows ?? [];
}

function toListRow(row: ListRowShape): SubmissionListRow {
  return submissionListRowSchema.parse({
    ...row,
    speakers: row.speakers ?? [],
    tags: row.tags ?? [],
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    nScores: Number(row.nScores ?? 0),
    notifiedAt: row.notifiedAt ? new Date(row.notifiedAt).toISOString() : null,
    submittedAt: row.submittedAt ? new Date(row.submittedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  });
}

export async function listSubmissionsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  filters: SubmissionFilters,
): Promise<{ rows: SubmissionListRow[]; total: number; page: number; pageSize: number }> {
  const where = whereClause(eventId, filters);
  const raw = await selectRows(dbOrTx, eventId, where, ORDER_BY[filters.sort], filters.pageSize, (filters.page - 1) * filters.pageSize);

  // The window count rides on the returned rows, so a page past the end reports
  // zero — and a table that has just been filtered would show "no results" with
  // no way back. Ask separately when there is nothing to ride on.
  let total = Number(raw[0]?.total ?? 0);
  if (raw.length === 0) {
    const counted = await dbOrTx.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM submissions s WHERE ${where}
    `);
    total = Number((counted.rows ?? [])[0]?.total ?? 0);
  }

  return { rows: raw.map(toListRow), total, page: filters.page, pageSize: filters.pageSize };
}


/**
 * The tab counts. They come from the same filter as the rows — a count computed
 * a different way is a count that eventually disagrees with what is on screen.
 * `all` deliberately includes drafts; the Submissions KPI elsewhere excludes
 * them, and conflating the two is how a dashboard starts lying.
 */
export async function getStatusCountsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  filters: Omit<SubmissionFilters, "status" | "page">,
): Promise<Record<SubmissionStatus | "all", number>> {
  const where = whereClause(eventId, { ...filters, status: "all" }, false);
  const result = await dbOrTx.execute<{ status: SubmissionStatus; n: number }>(sql`
    SELECT s.status, count(*)::int AS n FROM submissions s WHERE ${where} GROUP BY s.status
  `);

  const counts = {
    all: 0,
    draft: 0,
    pending: 0,
    accept_queue: 0,
    decline_queue: 0,
    accepted: 0,
    declined: 0,
    withdrawn: 0,
  } satisfies Record<SubmissionStatus | "all", number>;
  for (const row of result.rows ?? []) {
    counts[row.status] = Number(row.n);
    counts.all += Number(row.n);
  }
  return counts;
}

/**
 * The drawer. Answers come back with the snapshot they were submitted against —
 * the *pinned* one, not the current form — so a question renamed after the fact
 * still reads the way the speaker answered it.
 */
export async function getSubmissionDetailIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  submissionId: SubmissionId,
): Promise<SubmissionDetailDTO> {
  const [listRow] = await selectRows(dbOrTx, eventId, whereClause(eventId, ALL_FILTERS, false, submissionId), ORDER_BY.code, 1, 0);
  if (!listRow) throw new AppError("NOT_FOUND", "Submission not found");

  const detail = (await dbOrTx.execute<{
    description_html: string | null;
    starts_at: string | null;
    ends_at: string | null;
    form_version: number | null;
    form_id: string | null;
  }>(sql`
    SELECT description_html, starts_at, ends_at, form_version, form_id
    FROM submissions WHERE id = ${submissionId} AND event_id = ${eventId}
  `)).rows?.[0];
  if (!detail) throw new AppError("NOT_FOUND", "Submission not found");

  const participants = (await dbOrTx.execute<{
    id: string; contact_id: string; name: string; email: string; role: string; is_primary: boolean; sort_order: number;
  }>(sql`
    SELECT sp.id, sp.contact_id, btrim(c.first_name || ' ' || c.last_name) AS name, c.email,
           sp.role, sp.is_primary, sp.sort_order
    FROM submission_participants sp
    JOIN contacts c ON c.id = sp.contact_id AND c.event_id = sp.event_id
    WHERE sp.submission_id = ${submissionId} AND sp.event_id = ${eventId}
    ORDER BY sp.is_primary DESC, sp.sort_order
  `)).rows ?? [];

  const answers = (await dbOrTx.execute<{ field_id: string; participant_id: string | null; value: unknown }>(sql`
    SELECT field_id, participant_id, value FROM submission_answers
    WHERE submission_id = ${submissionId} AND event_id = ${eventId}
  `)).rows ?? [];

  // The *pinned* snapshot, not the current form: a question renamed after the
  // fact must still read the way the speaker answered it.
  const snapshotRow = detail.form_id && detail.form_version !== null
    ? (await dbOrTx.execute<{ snapshot: unknown }>(sql`
      SELECT snapshot FROM form_versions
      WHERE event_id = ${eventId} AND form_id = ${detail.form_id} AND version = ${detail.form_version}
    `)).rows?.[0]
    : undefined;
  const snapshot = snapshotRow ? formSnapshotSchema.parse(snapshotRow.snapshot) : null;

  // File answers resolve to their immutable /f/ URL here, so the panel never has
  // to know how files are served.
  const fileIds = answers
    .map((answer) => (answer.value as { t?: string; v?: string }))
    .filter((value) => value.t === "file" && typeof value.v === "string")
    .map((value) => value.v as string);
  const files: Record<string, { fileId: string; filename: string; href: string | null }> = {};
  if (fileIds.length > 0) {
    const assets = (await dbOrTx.execute<{ id: string; filename: string; kind: string }>(sql`
      SELECT id, filename, kind FROM file_assets WHERE event_id = ${eventId} AND id IN (${sql.join(fileIds.map((id) => sql`${id}`), sql`, `)})
    `)).rows ?? [];
    for (const asset of assets) {
      // Private kinds are fetched through a presigned URL, not a public path, so
      // there is deliberately no href for them here.
      const isPublic = asset.kind === "logo" || asset.kind === "background" || asset.kind === "headshot";
      files[asset.id] = { fileId: asset.id, filename: asset.filename, href: isPublic ? `/f/${asset.id}` : null };
    }
  }

  return {
    ...toListRow(listRow),
    descriptionHtml: detail.description_html,
    startsAt: detail.starts_at ? new Date(detail.starts_at).toISOString() : null,
    endsAt: detail.ends_at ? new Date(detail.ends_at).toISOString() : null,
    participants: participants.map((participant) => ({
      id: participant.id,
      contactId: participant.contact_id as SubmissionDetailDTO["participants"][number]["contactId"],
      name: participant.name,
      email: participant.email,
      role: participant.role as SubmissionDetailDTO["participants"][number]["role"],
      isPrimary: participant.is_primary,
      sortOrder: participant.sort_order,
    })),
    answerPanel: answerPanelDataSchema.parse({
      formVersion: detail.form_version,
      snapshot,
      answers: answers.map((answer) => ({ fieldId: answer.field_id, participantId: answer.participant_id, value: answer.value })),
      participants: participants.map((participant) => ({
        id: participant.id,
        contactId: participant.contact_id,
        name: participant.name,
        role: participant.role,
        isPrimary: participant.is_primary,
      })),
      files,
    }),
  };
}

export function listSubmissions(eventId: EventId, filters: SubmissionFilters) {
  return listSubmissionsIn(db, eventId, filters);
}

export function getStatusCounts(eventId: EventId, filters: Omit<SubmissionFilters, "status" | "page">) {
  return getStatusCountsIn(db, eventId, filters);
}

export function getSubmissionDetail(eventId: EventId, submissionId: SubmissionId) {
  return getSubmissionDetailIn(db, eventId, submissionId);
}
