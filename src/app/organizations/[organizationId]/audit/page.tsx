import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireOrganizationAdmin } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { getOrganization, listOrganizationAuditLog } from "@/features/organizations";
import { AuditLogPanel } from "@/features/organizations/components/audit-log-panel";
import { PageHeader } from "@/shared/ui/ui-kit";
import { organizationIdSchema } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { isAppError } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ organizationId: string }> }) {
  if (isCredentialFreeLocalDemo()) {
    return <PageHeader eyebrow="ORGANIZATION" title="Audit log" description="The audit log is unavailable in the credential-free demo." />;
  }
  const parsed = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsed.success) notFound();
  const organizationId = parsed.data;

  try {
    // Reading the log is the same bar as managing the team: organizer or above.
    await requireOrganizationAdmin(organizationId);
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (error.code === "UNAUTHORIZED") {
      const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), "/organizations");
      redirect(`/login?next=${encodeURIComponent(requestPath)}`);
    }
    notFound();
  }

  const [organization, entries] = await Promise.all([
    getOrganization(organizationId),
    listOrganizationAuditLog(organizationId),
  ]);
  if (!organization) notFound();

  return <>
    <PageHeader eyebrow="ORGANIZATION" title={`${organization.name} — Audit log`} description="Membership changes on this organization, most recent first." />
    <AuditLogPanel initialEntries={entries} />
  </>;
}
