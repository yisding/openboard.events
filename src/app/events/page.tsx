import type { Metadata } from "next";
import { EventsIndexDemoPage } from "@/features/events/events-index-demo-page";
import { EventsView } from "@/features/events/components/events-view";
import { listEvents } from "@/features/events";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

export const metadata: Metadata = { title: "Your events" };
export const dynamic = "force-dynamic";

export default async function Page() {
  // The credential-free demo has no database to read; everywhere else this is
  // the organizer's real event list.
  if (isCredentialFreeLocalDemo()) return <EventsIndexDemoPage />;

  const events = await listEvents();
  return <EventsView events={events} />;
}
