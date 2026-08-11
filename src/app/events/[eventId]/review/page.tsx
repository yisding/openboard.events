import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { requireAdmin } from "@/features/auth";
import { listReviewerPlans, listReviewQueue } from "@/features/submissions";
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
  // The rounds this member is actually on, already stripped of the committee
  // roster: this page is a client component's props, so whatever it reads is
  // whatever a reviewer can read.
  const plans = await listReviewerPlans(eventId, reviewerId);
  const planId = requestedPlanId && plans.some((plan) => plan.id === requestedPlanId) ? requestedPlanId : null;

  const queue = await listReviewQueue(eventId, reviewerId, planId);

  // The round's window is a deadline, and a deadline is rendered in the event's
  // zone like every other time in the product (`TzTime`). Read here rather than
  // formatted in the view, which is a client component: a `toLocaleString()`
  // there runs in UTC on the server and in the viewer's zone in the browser, so
  // the two disagree and React throws #418 on hydration — which is what this
  // page did until the timezone reached it.
  const [event] = await db.select({ timezone: events.timezone }).from(events).where(eq(events.id, eventId)).limit(1);

  return (
    <ReviewQueueView
      key={queue.plan?.id ?? "no-review-round"}
      eventId={eventId}
      timezone={event?.timezone ?? "America/Los_Angeles"}
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
