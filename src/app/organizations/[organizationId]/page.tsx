import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CreditCard, ScrollText, Sparkles, Users as UsersIcon } from "lucide-react";
import { requireOrganizationAdmin } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { getEvent } from "@/features/events";
import { EventCard } from "@/features/events/components/event-card";
import { getOrganization, listOrganizationEvents } from "@/features/organizations";
import { PageHeader } from "@/shared/ui/ui-kit";
import { organizationIdSchema, type EventDTO } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
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
  if (isCredentialFreeLocalDemo()) {
    return <PageHeader eyebrow="ORGANIZATION" title="Organization" description="Unavailable in the credential-free demo." />;
  }
  const parsed = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsed.success) notFound();
  const organizationId = parsed.data;

  try {
    await requireOrganizationAdmin(organizationId);
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (error.code === "UNAUTHORIZED") {
      const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), "/organizations");
      redirect(`/login?next=${encodeURIComponent(requestPath)}`);
    }
    notFound();
  }

  const organization = await getOrganization(organizationId);
  if (!organization) notFound();

  const eventRows = await listOrganizationEvents(organizationId);
  if (eventRows.length === 0) redirect(`/organizations/${organizationId}/onboarding`);

  const events = (await Promise.all(eventRows.map((row) => getEvent(row.id))))
    .filter((event): event is EventDTO => event !== null);

  return <>
    <PageHeader
      eyebrow="ORGANIZATION"
      title={organization.name}
      description="Your organization's events."
      actions={<>
        <Link href={`/organizations/${organizationId}/billing`} className="button button-secondary"><CreditCard size={16} /> Billing</Link>
        <Link href={`/organizations/${organizationId}/audit`} className="button button-secondary"><ScrollText size={16} /> Audit log</Link>
        <Link href={`/organizations/${organizationId}/team`} className="button button-secondary"><UsersIcon size={16} /> Team</Link>
        <Link href={`/organizations/${organizationId}/onboarding`} className="button button-primary"><Sparkles size={16} /> Create event</Link>
      </>}
    />
    <div className="event-grid">
      {events.map((event) => <EventCard key={event.id} event={event} />)}
    </div>
  </>;
}
