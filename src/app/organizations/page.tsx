import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Sparkles } from "lucide-react";
import { Brand } from "@/shared/ui/brand";
import { getAdminSession } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { listOrganizationsForUser, manageableOrganizations } from "@/features/organizations";
import { EmptyState } from "@/shared/ui/ui-kit";

export const metadata: Metadata = { title: "Your organizations" };
export const dynamic = "force-dynamic";

/**
 * M45 — the self-serve entry point. `SignupForm` (M44) redirects freshly
 * created accounts here instead of the global, organization-blind `/events`
 * list, so a new organization owner lands somewhere that actually knows
 * which organization it is and can hand them straight to the guided setup
 * wizard rather than the bare M11 "Create event" button.
 *
 * The common case — one organization, the one the signup hook just created —
 * skips this page entirely via the redirect below; it only renders for an
 * account that belongs to more than one organization (an invited teammate
 * who joined a second workspace). This route sits outside
 * `organizations/[organizationId]/layout.tsx` (there is no organization id
 * yet), so it draws its own copy of the same shell `/events` uses rather than
 * relying on that layout.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ intent?: string }> }) {
  const identity = await getAdminSession();
  if (!identity) {
    const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), "/organizations");
    redirect(`/login?next=${encodeURIComponent(requestPath)}`);
  }

  const memberships = await listOrganizationsForUser(identity.userId);
  const createIntent = (await searchParams).intent === "create-event";
  const visibleMemberships = createIntent ? manageableOrganizations(memberships) : memberships;
  const [onlyManageable] = visibleMemberships;
  // `?mode=create` (First Fair, design §1.2): arriving here with
  // `intent=create-event` *is* an explicit create intent, so it is carried
  // through rather than dropped — otherwise the guided-setup page would be
  // entitled to offer the demo fork to somebody who already chose.
  if (createIntent && visibleMemberships.length === 1 && onlyManageable) {
    redirect(`/organizations/${onlyManageable.organization.id}/onboarding?mode=create`);
  }
  const [only] = memberships;
  if (!createIntent && memberships.length === 0) redirect("/events");
  if (!createIntent && memberships.length === 1 && only) redirect(`/organizations/${only.organization.id}`);

  return <main className="events-index">
    <header className="events-index-header">
      <Brand dark />
      <Link href="/events" className="header-help">Back to events</Link>
    </header>
    <section className="events-index-content">
      <div className="events-title">
        <div>
          <div className="page-eyebrow">Workspace</div>
          <h1>{createIntent ? "Choose an organization" : "Your organizations"}</h1>
          <p>{createIntent ? "Your new event will be created with guided setup in this organization." : "Choose an organization to continue."}</p>
        </div>
      </div>
      {createIntent && visibleMemberships.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={20} />}
          title="Organizer access required"
          description="Only organization owners and organizers can create events. Ask an organization owner to update your role."
          action={<Link className="button button-secondary" href="/events">Back to events</Link>}
        />
      ) : <div className="event-grid">
        {visibleMemberships.map(({ organization, role }) => (
          <Link key={organization.id} href={createIntent ? `/organizations/${organization.id}/onboarding?mode=create` : `/organizations/${organization.id}`} className="panel settings-section org-picker-card">
            <span className="metric-icon accent"><Building2 size={20} /></span>
            <span>
              <b>{organization.name}</b>
              <small>/{organization.slug} · {role}</small>
            </span>
          </Link>
        ))}
      </div>}
    </section>
  </main>;
}
