import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import type { EventId, PlanId, SubmissionDetailDTO, SubmissionId, UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getSubmissionDetailIn } from "../../server/queries";
import { anonymizeSubmissionDetail } from "../blind";
import { assertReviewerCanReadSubmissionIn } from "./queries";

/**
 * A reviewer's copy of one submission.
 *
 * Authorization and blindness are both settled here, on the server, before the
 * object exists in a serializable form: the queue check runs first, the round's
 * own `anonymize_authors` flag decides the shape second, and the caller never
 * gets a choice about either. A route that forgot to anonymize would be a leak,
 * so no route is given the un-anonymized object to forget about.
 */

/**
 * The peer mean a reviewer may see for *this* round.
 *
 * `getSubmissionDetailIn` always carries `rating`/`nScores`, and scopes them to
 * the event's **active** plan — right for the organizer's table, wrong here on
 * two counts. `anonymizeSubmissionDetail` redacts identity, not scores, so the
 * queue's `CASE WHEN p.show_peer_scores` gate had no counterpart on this route:
 * a reviewer in a round configured to hide peer scores could read the committee
 * mean straight off the JSON. And when sharing *is* on, the active round's mean
 * is a number nobody in this round gave.
 */
async function peerScoreFor(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  showPeerScores: boolean,
): Promise<{ rating: number | null; nScores: number }> {
  if (!showPeerScores) return { rating: null, nScores: 0 };
  const rows = await dbOrTx.execute<{ rating: number | null; n_scores: number | null }>(sql`
    SELECT v.rating, v.n_scores
    FROM submission_ratings_v v
    WHERE v.submission_id = ${submissionId} AND v.event_id = ${eventId} AND v.plan_id = ${planId}
  `);
  const row = (rows.rows ?? [])[0];
  return { rating: row?.rating ?? null, nScores: Number(row?.n_scores ?? 0) };
}

export async function getReviewerSubmissionDetailIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
  now: Date = new Date(),
): Promise<SubmissionDetailDTO> {
  await assertReviewerCanReadSubmissionIn(dbOrTx, eventId, planId, submissionId, reviewerUserId, now);

  const planRows = await dbOrTx.execute<{ anonymize_authors: boolean; show_peer_scores: boolean }>(sql`
    SELECT anonymize_authors, show_peer_scores FROM evaluation_plans WHERE id = ${planId} AND event_id = ${eventId}
  `);
  const plan = (planRows.rows ?? [])[0];
  if (!plan) throw new AppError("NOT_FOUND", "Evaluation plan not found");

  const detail = await getSubmissionDetailIn(dbOrTx, eventId, submissionId);
  const shared = await peerScoreFor(dbOrTx, eventId, planId, submissionId, plan.show_peer_scores === true);
  const scoped = { ...detail, ...shared };
  return plan.anonymize_authors === true ? anonymizeSubmissionDetail(scoped) : scoped;
}

export const getReviewerSubmissionDetail = (
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
) => getReviewerSubmissionDetailIn(db, eventId, planId, submissionId, reviewerUserId);
