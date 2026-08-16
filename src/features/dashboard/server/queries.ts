import { sql, type SQLWrapper } from "drizzle-orm";
import type { EventId } from "@/shared/contracts";
import { SPEAKERS_DEEPLINK_PARAMS } from "@/shared/contracts";

export type DashboardQueryDb = {
  execute(query: SQLWrapper | string): PromiseLike<{ rows: Record<string, unknown>[] }>;
};

type OverviewRow = { overview: unknown };

export async function queryDashboardOverview(dbOrTx: DashboardQueryDb, eventId: EventId): Promise<unknown | null> {
  const missingParam = SPEAKERS_DEEPLINK_PARAMS.missing[2];
  const result = await dbOrTx.execute(sql`
    WITH
      ev AS (
        SELECT id, name, slug, timezone, starts_at
        FROM events
        WHERE id = ${eventId}
      ),
      sc AS (
        SELECT status::text AS status, n
        FROM submission_status_counts_v
        WHERE event_id = ${eventId}
      ),
      sc_json AS (
        SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb) AS counts
        FROM sc
      ),
      spk AS (
        SELECT count(*)::int AS n
        FROM accepted_speakers_v
        WHERE event_id = ${eventId}
      ),
      tasks AS (
        SELECT
          count(*) FILTER (WHERE NOT completed)::int AS open_n,
          count(*) FILTER (WHERE overdue)::int AS overdue_n
        FROM task_assignments_v
        WHERE event_id = ${eventId}
      ),
      top_rows AS (
        SELECT
          o.contact_id,
          coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Unnamed speaker') AS name,
          o.open_count,
          o.overdue_count
        FROM speaker_outstanding_v o
        JOIN contacts c ON c.id = o.contact_id AND c.event_id = o.event_id
        WHERE o.event_id = ${eventId} AND o.open_count > 0
        ORDER BY o.open_count DESC, o.overdue_count DESC, c.last_name, c.first_name, c.id
        LIMIT 8
      ),
      top_json AS (
        SELECT coalesce(
          jsonb_agg(jsonb_build_object(
            'contactId', contact_id,
            'name', name,
            'openCount', open_count,
            'overdueCount', overdue_count
          ) ORDER BY open_count DESC, overdue_count DESC, name),
          '[]'::jsonb
        ) AS rows
        FROM top_rows
      ),
      overdue_rows AS (
        SELECT
          a.contact_id,
          coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Unnamed speaker') AS name,
          a.task_id,
          t.name AS task_name,
          CASE WHEN s.code IS NULL THEN NULL ELSE 'SESS-' || s.code::text END AS submission_code,
          a.due_at
        FROM task_assignments_v a
        JOIN portal_tasks t ON t.id = a.task_id AND t.event_id = a.event_id
        JOIN contacts c ON c.id = a.contact_id AND c.event_id = a.event_id
        LEFT JOIN submissions s ON s.id = a.submission_id AND s.event_id = a.event_id
        WHERE a.event_id = ${eventId} AND a.overdue
        ORDER BY a.due_at ASC, a.task_id, a.contact_id
        LIMIT 10
      ),
      overdue_json AS (
        SELECT coalesce(
          jsonb_agg(jsonb_build_object(
            'contactId', contact_id,
            'name', name,
            'taskId', task_id,
            'taskName', task_name,
            'submissionCode', submission_code,
            'dueAt', due_at
          ) ORDER BY due_at ASC, task_id, contact_id),
          '[]'::jsonb
        ) AS rows
        FROM overdue_rows
      ),
      mix AS (
        SELECT
          count(*) FILTER (WHERE c.confirmation_status = 'confirmed')::int AS confirmed,
          count(*) FILTER (WHERE c.confirmation_status = 'unconfirmed')::int AS unconfirmed,
          count(*) FILTER (WHERE c.confirmation_status = 'declined')::int AS declined
        FROM accepted_speakers_v a
        JOIN contacts c ON c.id = a.contact_id AND c.event_id = a.event_id
        WHERE a.event_id = ${eventId}
      ),
      miss AS (
        SELECT
          count(*) FILTER (WHERE missing_bio OR missing_headshot)::int AS speakers,
          count(*) FILTER (WHERE missing_bio)::int AS bios,
          count(*) FILTER (WHERE missing_headshot)::int AS headshots
        FROM missing_assets_v
        WHERE event_id = ${eventId}
      ),
      sched AS (
        SELECT count(*)::int AS n
        FROM published_sessions_v
        WHERE event_id = ${eventId}
      ),
      unsched AS (
        SELECT count(*)::int AS n
        FROM submissions s
        WHERE s.event_id = ${eventId}
          AND s.status = 'accepted'
          AND NOT EXISTS (
            SELECT 1 FROM sessions x
            WHERE x.event_id = s.event_id AND x.submission_id = s.id AND x.starts_at IS NOT NULL
          )
      ),
      hidden_published AS (
        -- Published, timed sessions that published_sessions_v refuses to carry
        -- because their abstract stopped being accepted (drizzle/0045).
        -- Nothing flips sessions.status when a speaker withdraws, so this is
        -- the only place the dashboard can learn that the agenda now claims
        -- something the public schedule does not show.
        SELECT count(*)::int AS n
        FROM sessions s
        JOIN submissions sub ON sub.id = s.submission_id AND sub.event_id = s.event_id
        WHERE s.event_id = ${eventId}
          AND s.status = 'published'
          AND s.starts_at IS NOT NULL
          AND sub.status <> 'accepted'
      ),
      form_rows AS (
        SELECT
          f.id AS form_id,
          f.internal_name AS name,
          f.status::text AS status,
          f.opens_at,
          f.closes_at,
          count(s.id) FILTER (WHERE s.status <> 'draft')::int AS submitted,
          count(s.id) FILTER (WHERE s.status = 'draft')::int AS drafts
        FROM forms f
        LEFT JOIN submissions s ON s.form_id = f.id AND s.event_id = f.event_id
        WHERE f.event_id = ${eventId} AND f.context = 'cfp'
        GROUP BY f.id, f.internal_name, f.status, f.opens_at, f.closes_at
        ORDER BY f.created_at, f.id
      ),
      forms_json AS (
        SELECT coalesce(
          jsonb_agg(jsonb_build_object(
            'formId', form_id,
            'name', name,
            'status', status,
            'opensAt', opens_at,
            'closesAt', closes_at,
            'submitted', submitted,
            'drafts', drafts
          )),
          '[]'::jsonb
        ) AS rows
        FROM form_rows
      ),
      latest_cfp_submission AS (
        SELECT s.id, s.title
        FROM submissions s
        JOIN forms f ON f.id = s.form_id AND f.event_id = s.event_id AND f.context = 'cfp'
        WHERE s.event_id = ${eventId} AND s.status <> 'draft'
        ORDER BY coalesce(s.submitted_at, s.created_at) DESC, s.id
        LIMIT 1
      ),
      recent_rows AS (
        SELECT
          s.id,
          'SESS-' || s.code::text AS code,
          s.title,
          s.status::text AS status,
          coalesce(f.internal_name, initcap(s.source::text)) AS source,
          coalesce(speaker_names.names, '[]'::jsonb) AS speakers,
          coalesce(tag_names.names, '[]'::jsonb) AS tags,
          s.submitted_at,
          coalesce(s.submitted_at, s.created_at) AS activity_at
        FROM submissions s
        LEFT JOIN forms f ON f.id = s.form_id AND f.event_id = s.event_id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(name ORDER BY sort_order, name) AS names
          FROM (
            SELECT DISTINCT
              coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Unnamed speaker') AS name,
              sp.sort_order
            FROM submission_participants sp
            JOIN contacts c ON c.id = sp.contact_id AND c.event_id = sp.event_id
            WHERE sp.event_id = s.event_id AND sp.submission_id = s.id
          ) speaker_rows
        ) speaker_names ON true
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(name ORDER BY name) AS names
          FROM (
            SELECT DISTINCT t.name
            FROM submission_tags st
            JOIN tags t ON t.id = st.tag_id AND t.event_id = st.event_id
            WHERE st.event_id = s.event_id AND st.submission_id = s.id
          ) tag_rows
        ) tag_names ON true
        WHERE s.event_id = ${eventId} AND s.status <> 'draft'
        ORDER BY coalesce(s.submitted_at, s.created_at) DESC, s.id
        LIMIT 10
      ),
      recent_json AS (
        SELECT coalesce(
          jsonb_agg(jsonb_build_object(
            'id', id,
            'code', code,
            'title', title,
            'status', status,
            'source', source,
            'speakers', speakers,
            'tags', tags,
            'submittedAt', submitted_at
          ) ORDER BY activity_at DESC, id),
          '[]'::jsonb
        ) AS rows
        FROM recent_rows
      ),
      attention_rows AS (
        -- rank reaches the DTO, because the queue's client-side order depends
        -- on it: rank 0 is reserved for rows that describe something already
        -- wrong and leads however small its count is, while ranks 1+ are the
        -- to-do rows, ordered by how much is waiting with this fixed code order
        -- as the tiebreak so the list never jitters between polls.
        --
        -- Rank 0: a session the admin still calls "Published" while the public
        -- schedule has already dropped it. Same predicate as
        -- published_sessions_v (drizzle/0045) and as the client-side
        -- abstractDivergence(); the migration is the source all three copy.
        SELECT 0 AS rank, 'hidden_published' AS code, hidden.n AS count,
          '/events/' || ev.id::text || '/agenda?view=list' AS href
        FROM ev CROSS JOIN hidden_published hidden WHERE hidden.n > 0
        UNION ALL
        SELECT 1 AS rank, 'unscheduled_accepted' AS code, unsched.n AS count,
          '/events/' || ev.id::text || '/agenda?view=day' AS href
        FROM ev CROSS JOIN unsched WHERE unsched.n > 0
        UNION ALL
        SELECT 2, 'awaiting_decision', coalesce((sc_json.counts ->> 'pending')::int, 0),
          '/events/' || ev.id::text || '/abstracts?status=pending'
        FROM ev CROSS JOIN sc_json WHERE coalesce((sc_json.counts ->> 'pending')::int, 0) > 0
        UNION ALL
        SELECT 3, 'missing_assets', miss.speakers,
          '/events/' || ev.id::text || '/speakers?missing=' || ${missingParam}
        FROM ev CROSS JOIN miss WHERE miss.speakers > 0
      ),
      attention_json AS (
        SELECT coalesce(
          jsonb_agg(jsonb_build_object('rank', rank, 'code', code, 'count', count, 'href', href) ORDER BY rank),
          '[]'::jsonb
        ) AS rows
        FROM attention_rows
      )
    SELECT jsonb_build_object(
      'event', jsonb_build_object(
        'id', ev.id,
        'slug', ev.slug,
        'name', ev.name,
        'timezone', ev.timezone,
        'startsAt', ev.starts_at
      ),
      'kpis', jsonb_build_object(
        'submissions', coalesce((SELECT sum(n)::int FROM sc WHERE status <> 'draft'), 0),
        'acceptedSpeakers', spk.n,
        'scheduledSessions', sched.n,
        'unscheduledAccepted', unsched.n
      ),
      'statusCounts', sc_json.counts,
      'speakerTracking', jsonb_build_object(
        'acceptedSpeakers', spk.n,
        'outstandingTasks', tasks.open_n,
        'overdueTasks', tasks.overdue_n,
        'topByOutstanding', top_json.rows,
        'overdue', overdue_json.rows,
        'confirmationMix', jsonb_build_object(
          'confirmed', mix.confirmed,
          'unconfirmed', mix.unconfirmed,
          'declined', mix.declined
        ),
        'missingAssets', jsonb_build_object(
          'speakers', miss.speakers,
          'bios', miss.bios,
          'headshots', miss.headshots
        )
      ),
      'attention', attention_json.rows,
      'forms', forms_json.rows,
      'latestCfpSubmission', (
        SELECT jsonb_build_object('id', id, 'title', title)
        FROM latest_cfp_submission
      ),
      'recentSubmissions', recent_json.rows
    ) AS overview
    FROM ev
    CROSS JOIN spk
    CROSS JOIN tasks
    CROSS JOIN top_json
    CROSS JOIN overdue_json
    CROSS JOIN mix
    CROSS JOIN miss
    CROSS JOIN sched
    CROSS JOIN unsched
    CROSS JOIN sc_json
    CROSS JOIN forms_json
    CROSS JOIN recent_json
    CROSS JOIN attention_json
  `);
  return (result.rows[0] as OverviewRow | undefined)?.overview ?? null;
}
