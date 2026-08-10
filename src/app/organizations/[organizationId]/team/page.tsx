import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireOrganizationAdmin } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { getOrganization, listOrganizationMembers, listPendingOrganizationInvitations } from "@/features/organizations";
import { TeamPanel } from "@/features/organizations/components/team-panel";
import { PageHeader } from "@/shared/ui/ui-kit";
import { organizationIdSchema, type MemberRole, type UserId } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { isAppError } from "@/shared/lib/errors";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ organizationId: string }> }) {
  if (isCredentialFreeLocalDemo()) {
    return <PageHeader eyebrow="ORGANIZATION" title="Team" description="Role management is unavailable in the credential-free demo." />;
  }
  const parsed = organizationIdSchema.safeParse((await params).organizationId);
  if (!parsed.success) notFound();
  const organizationId = parsed.data;

  let role: MemberRole;
  let userId: UserId;
  try {
    const session = await requireOrganizationAdmin(organizationId);
    role = session.role;
    userId = session.userId;
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (error.code === "UNAUTHORIZED") {
      const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), "/organizations");
      redirect(`/login?next=${encodeURIComponent(requestPath)}`);
    }
    notFound();
  }

  const [organization, members, invitations] = await Promise.all([
    getOrganization(organizationId),
    listOrganizationMembers(organizationId),
    listPendingOrganizationInvitations(organizationId),
  ]);
  if (!organization) notFound();

  return <>
    <PageHeader eyebrow="ORGANIZATION" title={organization.name} description="Members, roles, and pending invitations for this organization." />
    <TeamPanel
      organizationId={organizationId}
      currentUserId={userId}
      currentRole={role}
      initialMembers={members}
      initialInvitations={invitations}
    />
  </>;
}
