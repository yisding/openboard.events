import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettingsShell } from "@/features/events/components/settings-shell";
import { getEvent, getEventVocabulary } from "@/features/events";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Event settings" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;
  // The layout above this page has already run `requireAdmin(eventId,
  // "organizer")` for every tab here (only `/review` gets the lighter reviewer
  // role), so no second auth check is needed before reading.
  const eventId = eventIdSchema.parse(rawEventId);
  const [event, vocabulary] = await Promise.all([getEvent(eventId), getEventVocabulary(eventId)]);
  if (!event) notFound();

  return <SettingsShell event={event} vocabulary={vocabulary} />;
}
