import { and, eq, sql, type SQL } from "drizzle-orm";
import { cache } from "react";
import { db, type DbOrTx } from "@/db/client";
import { eventDemoTour, eventTourSteps } from "@/db/schema";
import { tryRecordOrganizationOnboardingMilestoneIn } from "@/features/product-signals";
import { organizationIdSchema, type EventId, type UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import {
  demoTourBootstrapSchema,
  TOUR_QUEST_STEP_PREFIX,
  tourBaselineSchema,
  tourStateSchema,
  tourWorldSchema,
  WORLD_FACT_KEYS,
  type DemoTourBootstrap,
  type TourBaseline,
  type TourCursorPatch,
  type TourStateDTO,
  type TourStepRecord,
  type TourWorld,
  type WorldFactKey,
} from "../tour-schemas";

/**
 * First Fair — the tour's server state.
 *
 * Three ideas carry this module, and every one of them exists because the
 * tutorial is verified against the *world*, not against clicks:
 *
 * 1. **One query.** `getTourWorldIn` answers "has the world reached the
 *    objective yet?" in a single indexed statement. It is polled — armed-only,
 *    2 s backing off to 10 s — so a second round trip here is a second round
 *    trip per player per two seconds.
 * 2. **Compare-and-set on the cursor.** Every advance names the step it
 *    believes it is leaving. A double-fired advance, a slow retry racing a
 *    fresh click, or a stale second tab therefore applies exactly once, and
 *    the loser is told so rather than silently overwriting.
 * 3. **The armed baseline is a column, not client state.** A step arms
 *    against the facts it cares about *as they stood when it armed*; re-arming
 *    the same step keeps the baseline it already has. Without that, a reload
 *    mid-step re-captures the baseline at the current value: an action the
 *    player already took becomes invisible and has to be done twice, and an
 *    action taken before the arm can never register at all.
 */

type WorldRow = {
  form_fields: unknown; form_versions: unknown; submissions_total: unknown;
  pending_count: unknown; accepted_count: unknown; reviews_by_me: unknown;
  decision_emails_queued: unknown; sessions_scheduled: unknown; conflict_count: unknown;
  published_sessions: unknown; embed_enabled: unknown; template_updated_at: unknown;
  portal_task_completions: unknown; resource_pages_published: unknown; contacts_updated_at: unknown;
};

type SnapshotRow = WorldRow & {
  organization_id: string;
  user_id: string;
  chapter: string;
  tour_state: string;
  step_id: string;
  armed_step_id: string | null;
  armed_baseline: unknown;
  provision_phase: string;
  skipped_at_phase: string | null;
  dataset_version: unknown;
  /** The row's own version. See `updatedAt` on `tourStateSchema`. */
  updated_at: unknown;
  event_name: string;
  event_slug: string;
  cfp_form_id: string | null;
  editable_form_id: string | null;
  completed_step_ids: string[] | null;
  skipped_step_ids: string[] | null;
};

function toInt(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

/** Postgres hands timestamptz back as a string here and a Date there. */
function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Every scheduled session, once per subject it could collide on. This is the
 * SQL half of `detectConflicts`: same three subjects (room, speaker, track),
 * and unscheduled rows are excluded by construction rather than by a filter
 * somebody can forget to write.
 */
function conflictSubjects(eventId: EventId): SQL {
  return sql`
    SELECT 'room' AS kind, s.room_id::text AS subject_id, s.id AS session_id, s.starts_at, s.ends_at
      FROM sessions s
     WHERE s.event_id = ${eventId} AND s.starts_at IS NOT NULL AND s.ends_at IS NOT NULL AND s.room_id IS NOT NULL
    UNION ALL
    SELECT 'speaker', ss.contact_id::text, s.id, s.starts_at, s.ends_at
      FROM sessions s
      JOIN session_speakers ss ON ss.session_id = s.id AND ss.event_id = s.event_id
     WHERE s.event_id = ${eventId} AND s.starts_at IS NOT NULL AND s.ends_at IS NOT NULL
    UNION ALL
    SELECT 'track', s.track_id::text, s.id, s.starts_at, s.ends_at
      FROM sessions s
     WHERE s.event_id = ${eventId} AND s.starts_at IS NOT NULL AND s.ends_at IS NOT NULL AND s.track_id IS NOT NULL
  `;
}

/**
 * The overlap test is **strictly** `aStart < bEnd && bStart < aEnd`, matching
 * `detectConflicts` exactly: a 10:00–10:30 followed by a 10:30–11:00 is a
 * normal back-to-back pair, and the demo deliberately plants one of those to
 * prove the badge does not cry wolf. `least`/`greatest` collapse the two
 * directions of each pair, so a collision is counted once per subject, the
 * same way the pure engine keys its map.
 */
function conflictCount(eventId: EventId): SQL {
  return sql`(
    SELECT count(*)::int FROM (
      SELECT DISTINCT a.kind, a.subject_id,
             least(a.session_id::text, b.session_id::text) AS lo,
             greatest(a.session_id::text, b.session_id::text) AS hi
        FROM (${conflictSubjects(eventId)}) a
        JOIN (${conflictSubjects(eventId)}) b
          ON b.kind = a.kind
         AND b.subject_id = a.subject_id
         AND b.session_id <> a.session_id
         AND a.starts_at < b.ends_at
         AND b.starts_at < a.ends_at
    ) pairs
  )`;
}

/**
 * The whole world, as correlated sub-selects. Every one is keyed by
 * `event_id`, which every table involved indexes.
 */
function worldColumns(eventId: EventId, actorUserId: UserId): SQL {
  return sql`
    (SELECT count(*)::int FROM form_fields WHERE event_id = ${eventId} AND deleted_at IS NULL) AS form_fields,
    (SELECT count(*)::int FROM form_versions WHERE event_id = ${eventId}) AS form_versions,
    (SELECT count(*)::int FROM submissions WHERE event_id = ${eventId}) AS submissions_total,
    (SELECT count(*)::int FROM submissions WHERE event_id = ${eventId} AND status = 'pending') AS pending_count,
    (SELECT count(*)::int FROM submissions WHERE event_id = ${eventId} AND status = 'accepted') AS accepted_count,
    (SELECT count(*)::int FROM reviews
      WHERE event_id = ${eventId} AND reviewer_user_id = ${actorUserId} AND submitted_at IS NOT NULL) AS reviews_by_me,
    (SELECT count(*)::int FROM communication_logs
      WHERE event_id = ${eventId} AND template_key IN ('submission_accepted', 'submission_declined')) AS decision_emails_queued,
    (SELECT count(*)::int FROM sessions
      WHERE event_id = ${eventId} AND starts_at IS NOT NULL AND ends_at IS NOT NULL) AS sessions_scheduled,
    ${conflictCount(eventId)} AS conflict_count,
    (SELECT count(*)::int FROM sessions WHERE event_id = ${eventId} AND status = 'published') AS published_sessions,
    (SELECT EXISTS(SELECT 1 FROM embeds WHERE event_id = ${eventId} AND enabled)) AS embed_enabled,
    (SELECT max(updated_at) FROM email_templates WHERE event_id = ${eventId}) AS template_updated_at,
    (SELECT count(*)::int FROM task_completions WHERE event_id = ${eventId}) AS portal_task_completions,
    (SELECT count(*)::int FROM resource_pages WHERE event_id = ${eventId} AND published) AS resource_pages_published,
    (SELECT max(updated_at) FROM contacts WHERE event_id = ${eventId}) AS contacts_updated_at
  `;
}

function toWorld(row: WorldRow): TourWorld {
  return tourWorldSchema.parse({
    formFields: toInt(row.form_fields),
    formVersions: toInt(row.form_versions),
    submissionsTotal: toInt(row.submissions_total),
    pendingCount: toInt(row.pending_count),
    acceptedCount: toInt(row.accepted_count),
    reviewsByMe: toInt(row.reviews_by_me),
    decisionEmailsQueued: toInt(row.decision_emails_queued),
    sessionsScheduled: toInt(row.sessions_scheduled),
    conflictCount: toInt(row.conflict_count),
    publishedSessions: toInt(row.published_sessions),
    embedEnabled: row.embed_enabled === true || row.embed_enabled === "t" || row.embed_enabled === "true",
    templateUpdatedAt: iso(row.template_updated_at),
    portalTaskCompletions: toInt(row.portal_task_completions),
    resourcePagesPublished: toInt(row.resource_pages_published),
    contactsUpdatedAt: iso(row.contacts_updated_at),
  });
}

/**
 * The polled endpoint's payload, in one statement. Nothing here is cached and
 * nothing is derived from a client success handler: an objective completed in
 * a second tab, on a phone, or through a different route than the one the
 * coach card suggested still shows up on the next poll.
 */
export async function getTourWorldIn(dbOrTx: DbOrTx, eventId: EventId, actorUserId: UserId): Promise<TourWorld> {
  const result = await dbOrTx.execute<WorldRow>(sql`SELECT ${worldColumns(eventId, actorUserId)}`);
  const row = (result.rows ?? [])[0];
  if (!row) throw new AppError("INTERNAL", "Tour world snapshot returned no row");
  return toWorld(row);
}

/**
 * A baseline written by an older script version can name a fact this build no
 * longer has. Dropping the unknown key beats failing a poll: the step simply
 * re-arms against the facts that still exist.
 */
function parseBaseline(value: unknown): TourBaseline | null {
  if (value === null || value === undefined) return null;
  const raw: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const known = Object.entries(raw as Record<string, unknown>)
    .filter(([key]) => WORLD_FACT_KEYS.includes(key as WorldFactKey));
  return tourBaselineSchema.parse(Object.fromEntries(known));
}

function partitionSteps(ids: readonly string[] | null): { completed: string[]; questsDone: string[] } {
  const completed: string[] = [];
  const questsDone: string[] = [];
  for (const id of ids ?? []) {
    if (id.startsWith(TOUR_QUEST_STEP_PREFIX)) questsDone.push(id);
    else completed.push(id);
  }
  return { completed, questsDone };
}

/**
 * The cursor, the achievement log and the world — one statement, joined
 * through `events` so a real event is structurally incapable of producing a
 * tour row. `null` here *is* the "this is not a demo event" marker the event
 * layout reads.
 */
async function readSnapshotIn(dbOrTx: DbOrTx, eventId: EventId, actorUserId: UserId): Promise<SnapshotRow | null> {
  const result = await dbOrTx.execute<SnapshotRow>(sql`
    SELECT
      t.organization_id, t.user_id, t.chapter, t.tour_state, t.step_id, t.armed_step_id, t.armed_baseline,
      t.provision_phase, t.skipped_at_phase, t.dataset_version, t.updated_at,
      e.name AS event_name, e.slug AS event_slug,
      (SELECT f.id FROM forms f
        WHERE f.event_id = t.event_id AND f.context = 'cfp'
        ORDER BY f.created_at, f.id LIMIT 1) AS cfp_form_id,
      -- Chapter 2's "add a question" needs a form the builder will actually
      -- let the organizer restructure. assertStructuralAllowed refuses one
      -- that already carries a non-draft submission, which the demo's own
      -- call for speakers does two dozen times over.
      (SELECT f.id FROM forms f
        WHERE f.event_id = t.event_id
          AND NOT EXISTS (SELECT 1 FROM submissions s
                           WHERE s.form_id = f.id AND s.event_id = f.event_id AND s.status <> 'draft')
        ORDER BY f.created_at, f.id LIMIT 1) AS editable_form_id,
      (SELECT coalesce(array_agg(st.step_id ORDER BY st.completed_at, st.step_id)
                       FILTER (WHERE st.outcome = 'completed'), '{}'::text[])
         FROM event_tour_steps st WHERE st.event_id = t.event_id) AS completed_step_ids,
      (SELECT coalesce(array_agg(st.step_id ORDER BY st.completed_at, st.step_id)
                       FILTER (WHERE st.outcome = 'skipped'), '{}'::text[])
         FROM event_tour_steps st WHERE st.event_id = t.event_id) AS skipped_step_ids,
      ${worldColumns(eventId, actorUserId)}
    FROM event_demo_tour t
    JOIN events e ON e.id = t.event_id AND e.organization_id = t.organization_id AND e.is_demo
    WHERE t.event_id = ${eventId}
  `);
  return (result.rows ?? [])[0] ?? null;
}

function toState(eventId: EventId, row: SnapshotRow): TourStateDTO {
  const { completed, questsDone } = partitionSteps(row.completed_step_ids);
  return tourStateSchema.parse({
    eventId,
    chapter: row.chapter,
    stepId: row.step_id,
    status: row.tour_state,
    updatedAt: iso(row.updated_at),
    armedStepId: row.armed_step_id,
    armedBaseline: parseBaseline(row.armed_baseline),
    completed,
    questsDone,
    skipped: [...(row.skipped_step_ids ?? [])],
    world: toWorld(row),
  });
}

/** `GET /api/internal/events/[eventId]/tour`. `null` for any event without a demo tour. */
export async function getTourStateIn(dbOrTx: DbOrTx, eventId: EventId, actorUserId: UserId): Promise<TourStateDTO | null> {
  const row = await readSnapshotIn(dbOrTx, eventId, actorUserId);
  return row ? toState(eventId, row) : null;
}

export const getTourState = (eventId: EventId, actorUserId: UserId): Promise<TourStateDTO | null> =>
  getTourStateIn(db, eventId, actorUserId);

/**
 * What `src/app/events/[eventId]/layout.tsx` reads on every admin page of a
 * demo event, and what it gets back for a real one: `null`. The shell learns
 * "this is a demo" from the same call that gives it the cursor, so there is
 * no second query and no second source of truth.
 *
 * The *script* is deliberately absent. Step copy is domain data assembled by
 * the route module, not by a server reader — which is also what keeps the
 * dataset and the copy out of every non-demo organizer's bundle.
 *
 * Returned for **any** organizer of the demo event, because "this is a demo"
 * is a property of the event and the shell's ribbon, badge and palette all
 * read it from here. `isTourOwner` is what separates that from the cursor:
 * `event_demo_tour` is keyed by event and holds exactly one cursor and one
 * armed baseline, while `reviews_by_me` — the fact `judge.score` arms on — is
 * per caller. A second organizer running off the first one's row would either
 * sit on an objective that can never fire (their count starts below a baseline
 * captured from somebody else's work) or have a step auto-complete they never
 * did, and whoever advanced first would leave the other with "The tour moved
 * on". So only the organizer the row names may drive it.
 */
export async function getDemoTourBootstrapIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  actorUserId: UserId,
): Promise<DemoTourBootstrap | null> {
  const row = await readSnapshotIn(dbOrTx, eventId, actorUserId);
  if (!row) return null;
  return demoTourBootstrapSchema.parse({
    ...toState(eventId, row),
    provisionPhase: row.provision_phase,
    provisionReady: row.provision_phase === "ready",
    isTourOwner: row.user_id === actorUserId,
    skippedAtPhase: row.skipped_at_phase,
    context: {
      organizationId: row.organization_id,
      eventName: row.event_name,
      eventSlug: row.event_slug,
      cfpFormId: row.cfp_form_id,
      editableFormId: row.editable_form_id,
      datasetVersion: toInt(row.dataset_version),
    },
  });
}

/**
 * Memoized per request: the event layout reads this on every admin page of a
 * demo event, and the dashboard reads it again for its ribbon and resume card.
 * Two calls means two world snapshots, and the world snapshot carries
 * `conflictCount` — a self-join of a UNION over every scheduled session, which
 * is by some distance the most expensive thing on the page. A real event still
 * pays one index lookup that finds nothing, either way.
 */
export const getDemoTourBootstrap = cache(
  (eventId: EventId, actorUserId: UserId): Promise<DemoTourBootstrap | null> =>
    getDemoTourBootstrapIn(db, eventId, actorUserId),
);

/**
 * Keeping an existing baseline for the same step is the entire mechanism: an
 * armed step is baselined **once**, at the moment it armed, and every later
 * re-arm of that same step — a reload, a remount, a second tab — is a no-op.
 * A baseline is only (re)captured when the armed step actually changes, or
 * when the step armed without one.
 */
function armedBaselineExpression(armedStepId: string, baseline: TourBaseline | undefined): SQL {
  const next = baseline === undefined ? sql`NULL::jsonb` : sql`${JSON.stringify(baseline)}::jsonb`;
  return sql`CASE
    WHEN armed_step_id IS NOT DISTINCT FROM ${armedStepId} AND armed_baseline IS NOT NULL THEN armed_baseline
    ELSE ${next}
  END`;
}

/**
 * Arms a step without moving the cursor. Idempotent by design, so the client
 * may re-send it on every mount of the step it is already on.
 *
 * Scoped to the cursor's own organizer for the same reason every other writer
 * below is: the baseline is one column shared by the whole event, and the
 * facts it is compared against are per caller.
 */
export async function armTourStepIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
  eventId: EventId,
  armedStepId: string,
  baseline?: TourBaseline,
): Promise<{ armedStepId: string; armedBaseline: TourBaseline | null }> {
  const [updated] = await dbOrTx.update(eventDemoTour)
    .set({
      armedStepId,
      armedBaseline: armedBaselineExpression(armedStepId, baseline),
      updatedAt: new Date(),
    })
    .where(and(eq(eventDemoTour.eventId, eventId), eq(eventDemoTour.userId, actorUserId)))
    .returning();
  if (!updated) throw new AppError("NOT_FOUND", "This event has no guided tour");
  return { armedStepId, armedBaseline: parseBaseline(updated.armedBaseline) };
}

/**
 * Advances (or pauses, resumes, completes) the cursor, and arms or releases
 * the step in the same statement.
 *
 * The `step_id = expectedStepId` predicate is the compare-and-set. Losing it
 * is not an error the player should ever see when the loss is a replay: a
 * second delivery of an advance that already landed returns the current state
 * instead of a 409, and only a genuine divergence conflicts.
 *
 * `user_id = actorUserId` sits beside it. The route is organizer-gated on the
 * *event*, and a demo event can have more than one organizer — but there is
 * one cursor and one armed baseline, and `reviews_by_me` is per caller. A
 * co-organizer who is not the cursor's owner gets `NOT_FOUND` (their shell
 * never mounted the tour: see `isTourOwner`) rather than the chance to drag
 * somebody else's playthrough sideways.
 */
export async function advanceTourCursorIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
  eventId: EventId,
  input: TourCursorPatch,
): Promise<TourStateDTO> {
  const arming = input.armedStepId;
  // Releasing the arm is what *leaving* a step does. Staying on it — a pause,
  // a resume, a status change in place — keeps it armed, so an action taken
  // while the tour was paused is still measured against the baseline the step
  // armed with rather than against a fresher one that already includes it.
  const armedStepId = arming === undefined
    ? sql`CASE WHEN armed_step_id = ${input.stepId} THEN armed_step_id ELSE NULL END`
    : sql`${arming}`;
  const armedBaseline = arming === undefined
    ? sql`CASE WHEN armed_step_id = ${input.stepId} THEN armed_baseline ELSE NULL END`
    : armedBaselineExpression(arming, input.armedBaseline);

  const [updated] = await dbOrTx.update(eventDemoTour)
    .set({
      chapter: input.chapter,
      stepId: input.stepId,
      tourState: input.status,
      armedStepId,
      armedBaseline,
      startedAt: sql`CASE WHEN started_at IS NOT NULL THEN started_at
                          WHEN ${input.status} <> 'not_started' THEN now()
                          ELSE NULL END`,
      // Cleared when a restart takes the tour out of `complete`: the row is a
      // cursor, not an audit log. The `tour_completed` milestone is the
      // permanent record, and it is first-occurrence-only by design.
      completedAt: sql`CASE WHEN ${input.status} = 'complete' THEN coalesce(completed_at, now()) ELSE NULL END`,
      updatedAt: new Date(),
    })
    .where(sql`${eventDemoTour.eventId} = ${eventId}
      AND ${eventDemoTour.userId} = ${actorUserId}
      AND ${eventDemoTour.stepId} = ${input.expectedStepId}
      AND (${eventDemoTour.provisionPhase} = 'ready' OR ${input.status} <> 'active')`)
    .returning();

  if (!updated) {
    const [current] = await dbOrTx.select({
      stepId: eventDemoTour.stepId,
      provisionPhase: eventDemoTour.provisionPhase,
    }).from(eventDemoTour)
      .where(and(eq(eventDemoTour.eventId, eventId), eq(eventDemoTour.userId, actorUserId)))
      .limit(1);
    if (!current) throw new AppError("NOT_FOUND", "This event has no guided tour");
    if (input.status === "active" && current.provisionPhase !== "ready") {
      throw new AppError("CONFLICT", "The demo event is still being built");
    }
    if (current.stepId !== input.stepId) {
      throw new AppError("CONFLICT", "The tour moved on; reload to pick it up where it is");
    }
    // Same destination, so an earlier delivery of this advance already won.
    const replayed = await getTourStateIn(dbOrTx, eventId, actorUserId);
    if (!replayed) throw new AppError("NOT_FOUND", "This event has no guided tour");
    return replayed;
  }

  if (input.status === "complete") {
    await tryRecordOrganizationOnboardingMilestoneIn(
      dbOrTx,
      organizationIdSchema.parse(updated.organizationId),
      "tour_completed",
      actorUserId,
    );
  }

  const state = await getTourStateIn(dbOrTx, eventId, actorUserId);
  if (!state) throw new AppError("NOT_FOUND", "This event has no guided tour");
  return state;
}

export const advanceTourCursor = (
  actorUserId: UserId,
  eventId: EventId,
  input: TourCursorPatch,
): Promise<TourStateDTO> => advanceTourCursorIn(db, actorUserId, eventId, input);

/**
 * `POST …/tour/steps`. Append-only: the first record of a step wins, and a
 * duplicate is a successful no-op rather than a conflict, so the client may
 * fire-and-forget an objective completion without holding a lock or a lock's
 * worth of retry logic. `recorded: false` means "already in the log".
 */
export async function recordTourStepIn(
  dbOrTx: DbOrTx,
  actorUserId: UserId,
  eventId: EventId,
  input: TourStepRecord,
): Promise<{ recorded: boolean }> {
  const [tour] = await dbOrTx.select({ eventId: eventDemoTour.eventId })
    .from(eventDemoTour)
    .where(and(eq(eventDemoTour.eventId, eventId), eq(eventDemoTour.userId, actorUserId)))
    .limit(1);
  if (!tour) throw new AppError("NOT_FOUND", "This event has no guided tour");
  const [inserted] = await dbOrTx.insert(eventTourSteps)
    .values({ eventId, stepId: input.stepId, outcome: input.outcome })
    .onConflictDoNothing({ target: [eventTourSteps.eventId, eventTourSteps.stepId] })
    .returning();
  return { recorded: Boolean(inserted) };
}

export const recordTourStep = (
  actorUserId: UserId,
  eventId: EventId,
  input: TourStepRecord,
): Promise<{ recorded: boolean }> => recordTourStepIn(db, actorUserId, eventId, input);
