import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/features/auth";
import { SettingsShell } from "@/features/events/components/settings-shell";
import { getEvent, getEventVocabulary } from "@/features/events";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Event settings" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;
  const eventId = eventIdSchema.parse(rawEventId);
  // The layout runs the same guard, but it does not re-run on a client-side
  // navigation between sibling segments, so the page has to hold the bar
  // itself before it reads anything.
  await requireAdmin(eventId, "organizer");
  const [event, vocabulary] = await Promise.all([getEvent(eventId), getEventVocabulary(eventId)]);
  if (!event) notFound();

  return <SettingsShell event={event} vocabulary={vocabulary} />;
}
