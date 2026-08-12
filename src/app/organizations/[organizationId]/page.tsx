import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Contact, CreditCard, ScrollText, Sparkles, Users as UsersIcon } from "lucide-react";
import { requireOrganizationAdmin, roleSatisfies } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { isBillingSurfaceEnabled } from "@/features/billing";
import { getEvent } from "@/features/events";
import { EventCard } from "@/features/events/components/event-card";
import { getOrganization, listOrganizationEventsForUser } from "@/features/organizations";
import { getActiveOrganizationOnboardingForUser } from "@/features/onboarding";
import { PageHeader } from "@/shared/ui/ui-kit";
import { organizationIdSchema, type EventDTO, type MemberRole, type UserId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Organization" };
export const dynamic = "force-dynamic";

/**
 * M45 — organization home. The landing page a self-serve organization's
 * members reach after `/organizations` resolves down to it (or that a
 * multi-organization member picks from the chooser). An organization with no
 * events yet skips straight to the guided setup wizard — the "under 15
 * minutes, no docs" ease bar (`docs/user-flows.md`) does not survive an extra
 * empty-state click — everyone else sees their program list and a way back
 * into it, plus links to M44's Team and Audit surfaces this page is the
 * first place either becomes reachable without typing the URL by hand.
 */
export default async function Page({ params }: { params: Promise<{ organizationId: string }> }) {
  const parsed = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsed.success) notFound();
  const organizationId = parsed.data;

  let canManageEvents = false;
  let actorUserId: UserId | null = null;
  try {
    const session = await requireOrganizationAdmin(organizationId);
    actorUserId = session.userId;
    canManageEvents = roleSatisfies(session.role, "organizer");
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (error.code === "UNAUTHORIZED") {
      const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), "/organizations");
      redirect(`/login?next=${encodeURIComponent(requestPath)}`);
    }
    notFound();
  }
  if (!actorUserId) notFound();

  const [organization, eventRows, progress] = await Promise.all([
    getOrganization(organizationId),
    listOrganizationEventsForUser(organizationId, actorUserId),
    getActiveOrganizationOnboardingForUser(organizationId, actorUserId),
  ]);
  if (!organization) notFound();
  if ((canManageEvents && eventRows.length === 0) || (canManageEvents && progress)) {
    redirect(`/organizations/${organizationId}/onboarding`);
  }

  const events = (await Promise.all(eventRows.map(async (row) => ({ event: await getEvent(row.id), eventRole: row.eventRole }))))
    .filter((row): row is { event: EventDTO; eventRole: MemberRole | null } => row.event !== null);
  const billingEnabled = isBillingSurfaceEnabled();

  return <>
    <PageHeader
      eyebrow="ORGANIZATION"
      title={organization.name}
      description="Your organization's event directory. Event access is assigned separately."
      actions={canManageEvents ? <>
        <Link href={`/organizations/${organizationId}/crm`} className="button button-secondary"><Contact size={16} /> Speaker CRM</Link>
        {billingEnabled && <Link href={`/organizations/${organizationId}/billing`} className="button button-secondary"><CreditCard size={16} /> Billing</Link>}
        <Link href={`/organizations/${organizationId}/audit`} className="button button-secondary"><ScrollText size={16} /> Audit log</Link>
        <Link href={`/organizations/${organizationId}/team`} className="button button-secondary"><UsersIcon size={16} /> Team</Link>
        <Link href={`/organizations/${organizationId}/onboarding`} className="button button-primary"><Sparkles size={16} /> Create event</Link>
      </> : undefined}
    />
    <div className="event-grid">
      {events.map(({ event, eventRole }) => <EventCard key={event.id} event={event} eventRole={eventRole} />)}
    </div>
  </>;
}
