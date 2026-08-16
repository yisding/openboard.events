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
import { ExportOrganizationButton } from "@/features/organizations/components/export-organization-button";
import { organizationHomeDestination } from "@/features/organizations/event-creation";
import { getActiveOrganizationOnboardingForUser } from "@/features/onboarding";
import { EmptyState, PageHeader } from "@/shared/ui/ui-kit";
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
export default async function Page({ params, searchParams }: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ skip?: string }>;
}) {
  const parsed = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsed.success) notFound();
  const organizationId = parsed.data;
  // First Fair (design §1.1): the start fork's "skip both" escape hatch is a
  // query parameter, not a cookie — App Router cannot call `cookies().set()`
  // during a page render, so the only way to say "not this time" for exactly
  // one request is to say it in the URL.
  const skipRequested = (await searchParams).skip === "1";

  let canManageEvents = false;
  let isOwner = false;
  let actorUserId: UserId | null = null;
  try {
    const session = await requireOrganizationAdmin(organizationId);
    actorUserId = session.userId;
    canManageEvents = roleSatisfies(session.role, "organizer");
    isOwner = roleSatisfies(session.role, "owner");
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

  // First Fair (design §1.4). A demo event is a tutorial, not a programme:
  // it must not silence the eventless nudge (Trap B), and it must never
  // outrank a half-built real event (Trap C).
  const realEventCount = eventRows.filter((row) => !row.isDemo).length;
  const demoEventRow = eventRows.find((row) => row.isDemo) ?? null;
  if (organizationHomeDestination({
    canManageEvents,
    realEventCount,
    hasDemoEvent: demoEventRow !== null,
    hasOpenCheckpoint: progress !== null,
    skipRequested,
  }) === "onboarding") {
    redirect(`/organizations/${organizationId}/onboarding`);
  }

  const events = (await Promise.all(eventRows.map(async (row) => ({ event: await getEvent(row.id), eventRole: row.eventRole, isDemo: row.isDemo }))))
    .filter((row): row is { event: EventDTO; eventRole: MemberRole | null; isDemo: boolean } => row.event !== null);
  const billingEnabled = isBillingSurfaceEnabled();
  // The demo has done its job the moment the organizer wants a real one, so
  // an organization holding nothing but a demo leads with that instead of
  // with the grid (design §5.4).
  const leadWithCreate = canManageEvents && realEventCount === 0 && demoEventRow !== null;

  return <>
    <PageHeader
      eyebrow="ORGANIZATION"
      title={organization.name}
      description={leadWithCreate
        ? "Your demo event is a complete conference you can break safely. When you are ready for the real one, everything you learned in there still applies."
        : "Your organization's event directory. Event access is assigned separately."}
      actions={canManageEvents ? <>
        <Link href={`/organizations/${organizationId}/crm`} className="button button-secondary"><Contact size={16} /> Speaker CRM</Link>
        {billingEnabled && <Link href={`/organizations/${organizationId}/billing`} className="button button-secondary"><CreditCard size={16} /> Billing</Link>}
        <Link href={`/organizations/${organizationId}/audit`} className="button button-secondary"><ScrollText size={16} /> Audit log</Link>
        <Link href={`/organizations/${organizationId}/team`} className="button button-secondary"><UsersIcon size={16} /> Team</Link>
        {/* M47 — the organization data export (GDPR). Owner-only: the bundle
            carries the member list, pending invitations and full audit trail,
            so it sits one step above the organizer bar its endpoint enforces. */}
        {isOwner && <ExportOrganizationButton organizationId={organizationId} organizationName={organization.name} />}
        {/* First Fair (design §1.3): one of the four pull-based entrances into
            the demo, offered only while this organization has none. It is a
            secondary action beside a primary "Create event" — a tutorial
            should be easy to find and never in the way. */}
        {!demoEventRow && <Link href={`/organizations/${organizationId}/onboarding?mode=demo`} className="button button-secondary"><Sparkles size={16} /> Explore a demo event</Link>}
        <Link href={`/organizations/${organizationId}/onboarding?mode=create`} className="button button-primary"><Sparkles size={16} /> {leadWithCreate ? "Create your real event" : "Create event"}</Link>
      </> : undefined}
    />
    {events.length === 0
      // Reachable only through the start fork's `?skip=1` — "not right now"
      // buys exactly one request without the redirect, and this is what it
      // buys. Both doors stay open, and neither is forced.
      ? <EmptyState
        icon={<Sparkles size={20} />}
        title="No events here yet"
        description={canManageEvents
          ? "Set up your real conference when you are ready, or spend ten minutes inside a finished one first. Neither choice rules the other out."
          : "Nobody has given you access to an event in this organization yet."}
        {...(canManageEvents ? {
          action: <Link href={`/organizations/${organizationId}/onboarding`} className="button button-primary">Choose how to start</Link>,
        } : {})}
      />
      : <div className="event-grid">
        {events.map(({ event, eventRole, isDemo }) => <EventCard key={event.id} event={event} eventRole={eventRole} isDemo={isDemo} />)}
      </div>}
  </>;
}
