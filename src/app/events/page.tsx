import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EventsView } from "@/features/events/components/events-view";
import { listEvents } from "@/features/events";
import { getAdminSession } from "@/features/auth";
import { eventCreationDestination, listOrganizationsForUser, manageableOrganizations } from "@/features/organizations";

export const metadata: Metadata = { title: "Your events" };
export const dynamic = "force-dynamic";

export default async function Page() {
  // `listEvents` is caller-scoped (see `listEventsIn`), so this page needs the
  // identity rather than just the middleware's cookie check. The middleware
  // redirect is a convenience; this is the decision.
  const identity = await getAdminSession();
  if (!identity) redirect("/login?next=%2Fevents");

  const [events, memberships] = await Promise.all([
    listEvents(identity.userId),
    listOrganizationsForUser(identity.userId),
  ]);
  const createHref = manageableOrganizations(memberships).length > 0
    ? eventCreationDestination(memberships)
    : null;
  return <EventsView events={events} user={{ name: identity.name, email: identity.email }} createHref={createHref} />;
}
