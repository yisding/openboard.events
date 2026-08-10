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
export async function getReviewerSubmissionDetailIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
  now: Date = new Date(),
): Promise<SubmissionDetailDTO> {
  await assertReviewerCanReadSubmissionIn(dbOrTx, eventId, planId, submissionId, reviewerUserId, now);

  const planRows = await dbOrTx.execute<{ anonymize_authors: boolean }>(sql`
    SELECT anonymize_authors FROM evaluation_plans WHERE id = ${planId} AND event_id = ${eventId}
  `);
  const plan = (planRows.rows ?? [])[0];
  if (!plan) throw new AppError("NOT_FOUND", "Evaluation plan not found");

  const detail = await getSubmissionDetailIn(dbOrTx, eventId, submissionId);
  return plan.anonymize_authors === true ? anonymizeSubmissionDetail(detail) : detail;
}

export const getReviewerSubmissionDetail = (
  eventId: EventId,
  planId: PlanId,
  submissionId: SubmissionId,
  reviewerUserId: UserId,
) => getReviewerSubmissionDetailIn(db, eventId, planId, submissionId, reviewerUserId);
