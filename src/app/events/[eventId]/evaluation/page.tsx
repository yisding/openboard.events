import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events, tracks } from "@/db/schema";
import { requireAdmin } from "@/features/auth";
import { listEventMembers, listPlans } from "@/features/submissions";
import { listPendingEventReviewerInvitations } from "@/features/organizations";
import { PlansView } from "@/features/submissions/evaluation/components/plans-view";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Evaluation" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;
  const eventId = eventIdSchema.parse(rawEventId);
  // Running the review process is an organizer's job — a reviewer scores at
  // /review and gets the layout's friendly refusal here.
  await requireAdmin(eventId, "organizer");

  const [plans, members, pendingReviewerInvitations, trackRows, event] = await Promise.all([
    listPlans(eventId),
    listEventMembers(eventId),
    listPendingEventReviewerInvitations(eventId),
    db.select({ id: tracks.id, name: tracks.name, color: tracks.color })
      .from(tracks)
      .where(and(eq(tracks.eventId, eventId)))
      .orderBy(tracks.sortOrder),
    db.select({ timezone: events.timezone, isDemo: events.isDemo }).from(events).where(eq(events.id, eventId)).limit(1),
  ]);

  return (
    <PlansView
      eventId={eventId}
      plans={plans}
      members={members}
      pendingReviewerInvitations={pendingReviewerInvitations}
      tracks={trackRows}
      timezone={event[0]?.timezone ?? "America/Los_Angeles"}
      isDemo={event[0]?.isDemo ?? false}
    />
  );
}
