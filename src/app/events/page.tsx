import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EventsView } from "@/features/events/components/events-view";
import { listEvents } from "@/features/events";
import { getAdminSession } from "@/features/auth";

export const metadata: Metadata = { title: "Your events" };
export const dynamic = "force-dynamic";

export default async function Page() {
  // `listEvents` is caller-scoped (see `listEventsIn`), so this page needs the
  // identity rather than just the middleware's cookie check. The middleware
  // redirect is a convenience; this is the decision.
  const identity = await getAdminSession();
  if (!identity) redirect("/login?next=%2Fevents");

  const events = await listEvents(identity.userId);
  return <EventsView events={events} user={{ name: identity.name, email: identity.email }} />;
}
