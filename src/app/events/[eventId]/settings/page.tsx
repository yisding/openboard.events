import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EventSettingsPage } from "@/features/events/event-settings-page";
import { SettingsShell } from "@/features/events/components/settings-shell";
import { getEvent, getEventVocabulary } from "@/features/events";
import { eventIdSchema } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

export const metadata: Metadata = { title: "Event settings" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;
  // The credential-free demo has no database to read; everywhere else these
  // are the event's real details and vocabulary. The layout above this page
  // has already run `requireAdmin(eventId, "organizer")` for every tab here
  // (only `/review` gets the lighter reviewer role), so no second auth check
  // is needed before reading.
  if (isCredentialFreeLocalDemo()) return <EventSettingsPage eventId={rawEventId} />;

  const eventId = eventIdSchema.parse(rawEventId);
  const [event, vocabulary] = await Promise.all([getEvent(eventId), getEventVocabulary(eventId)]);
  if (!event) notFound();

  return <SettingsShell event={event} vocabulary={vocabulary} />;
}
