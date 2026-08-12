import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireOrganizationAdmin } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { getOrganizationBillingSummary, isBillingSurfaceEnabled, listBillingPlans } from "@/features/billing";
import { BillingPanel } from "@/features/billing/components/billing-panel";
import { getOrganization } from "@/features/organizations";
import { PageHeader } from "@/shared/ui/ui-kit";
import { organizationIdSchema, type MemberRole } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

/**
 * M49 — the billing settings surface. Same shape as `[organizationId]/team`:
 * `requireOrganizationAdmin` gates the page (organizer+), the panel itself
 * further restricts plan changes to owners.
 */
export default async function Page({ params }: { params: Promise<{ organizationId: string }> }) {
  if (!isBillingSurfaceEnabled()) notFound();
  const parsed = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsed.success) notFound();
  const organizationId = parsed.data;

  let role: MemberRole;
  try {
    const session = await requireOrganizationAdmin(organizationId, "organizer");
    role = session.role;
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

  const [summary, plans] = await Promise.all([
    getOrganizationBillingSummary(organizationId),
    listBillingPlans(),
  ]);

  return <>
    <PageHeader eyebrow="ORGANIZATION" title="Billing" description={`Plan and usage for ${organization.name}.`} />
    <BillingPanel organizationId={organizationId} currentRole={role} summary={summary} plans={plans} />
  </>;
}
