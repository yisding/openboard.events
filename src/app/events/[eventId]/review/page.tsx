import type { Metadata } from "next";
import { requireAdmin } from "@/features/auth";
import { listPlans, listReviewQueue } from "@/features/submissions";
import { ReviewQueueView } from "@/features/submissions/evaluation/components/review-queue-view";
import { eventIdSchema, planIdSchema, userIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Review" };
export const dynamic = "force-dynamic";

/**
 * The reviewer's own surface. `requireAdmin(eventId, "reviewer")` is the lowest
 * rank in the event, so organizers reach it too — the queue is still scoped to
 * the session's user, and a member with no assignment sees an empty one rather
 * than the whole event.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const eventId = eventIdSchema.parse((await params).eventId);
  const session = await requireAdmin(eventId, "reviewer");

  const query = await searchParams;
  const requestedPlanId = typeof query.planId === "string" ? planIdSchema.parse(query.planId) : null;
  const reviewerId = userIdSchema.parse(session.userId);
  const allPlans = await listPlans(eventId);
  const plans = allPlans.filter((plan) => plan.reviewers.some((reviewer) => reviewer.userId === reviewerId));
  const planId = requestedPlanId && plans.some((plan) => plan.id === requestedPlanId) ? requestedPlanId : null;

  const queue = await listReviewQueue(eventId, reviewerId, planId);

  return (
    <ReviewQueueView
      key={queue.plan?.id ?? "no-review-round"}
      eventId={eventId}
      plan={queue.plan}
      // Open rounds first: switching to a closed one is deliberate, not the
      // default a reviewer lands on.
      plans={[...plans].sort((left, right) => Number(right.status === "open") - Number(left.status === "open") || left.round - right.round)}
      rows={queue.rows}
      progress={queue.progress}
      window={queue.window}
    />
  );
}
