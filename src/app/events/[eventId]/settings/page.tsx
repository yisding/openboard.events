import type { Metadata } from "next";
import { EventSettingsPage } from "@/features/events/event-settings-page";

export const metadata: Metadata = { title: "Event settings" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <EventSettingsPage eventId={eventId} />;
}
