import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events, tracks } from "@/db/schema";
import { requireAdmin } from "@/features/auth";
import { EvaluationPage } from "@/features/evaluation/evaluation-page";
import { listEventMembers, listPlans } from "@/features/submissions";
import { PlansView } from "@/features/submissions/evaluation/components/plans-view";
import { eventIdSchema } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

export const metadata: Metadata = { title: "Evaluation" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;
  // The credential-free demo has no database to read; everywhere else these are
  // the event's real rounds.
  if (isCredentialFreeLocalDemo()) return <EvaluationPage eventId={rawEventId} />;

  const eventId = eventIdSchema.parse(rawEventId);
  // Running the review process is an organizer's job — a reviewer scores at
  // /review and gets the layout's friendly refusal here.
  await requireAdmin(eventId, "organizer");

  const [plans, members, trackRows, event] = await Promise.all([
    listPlans(eventId),
    listEventMembers(eventId),
    db.select({ id: tracks.id, name: tracks.name, color: tracks.color })
      .from(tracks)
      .where(and(eq(tracks.eventId, eventId)))
      .orderBy(tracks.sortOrder),
    db.select({ timezone: events.timezone }).from(events).where(eq(events.id, eventId)).limit(1),
  ]);

  return (
    <PlansView
      eventId={eventId}
      plans={plans}
      members={members}
      tracks={trackRows}
      timezone={event[0]?.timezone ?? "America/Los_Angeles"}
    />
  );
}
