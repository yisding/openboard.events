import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireOrganizationAdmin } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { getOrganization, listOrganizationEvents } from "@/features/organizations";
import { OnboardingWizard } from "@/features/onboarding/components/onboarding-wizard";
import { PageHeader } from "@/shared/ui/ui-kit";
import { organizationIdSchema } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { isAppError } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Set up your event" };
export const dynamic = "force-dynamic";

/**
 * M45 — the guided setup wizard's page shell. This is the replacement for
 * the "manual provisioning runbook" the roadmap names: a signed-up
 * organization reaches this from `/organizations` (first event) or its
 * organization home's "Create event" button (subsequent events) and leaves
 * with a scoped event, a couple of tracks, and a shareable CFP link — the
 * `docs/user-flows.md` "under 15 minutes, no documentation" bar.
 */
export default async function Page({ params }: { params: Promise<{ organizationId: string }> }) {
  if (isCredentialFreeLocalDemo()) {
    return <PageHeader eyebrow="ORGANIZATION" title="Set up your event" description="Guided setup is unavailable in the credential-free demo." />;
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

  const [organization, eventRows] = await Promise.all([
    getOrganization(organizationId),
    listOrganizationEvents(organizationId),
  ]);
  if (!organization) notFound();

  return <>
    <PageHeader eyebrow="ORGANIZATION" title="Set up your event" description="Event basics, vocabulary, then your first call for speakers form." />
    <OnboardingWizard organizationId={organizationId} organizationName={organization.name} hasExistingEvents={eventRows.length > 0} />
  </>;
}
