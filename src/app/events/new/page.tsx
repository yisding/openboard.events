import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Building2 } from "lucide-react";
import { getAdminSession, roleSatisfies } from "@/features/auth";
import { listOrganizationsForUser } from "@/features/organizations";
import { Brand } from "@/shared/ui/brand";
import { EmptyState } from "@/shared/ui/ui-kit";

export const metadata: Metadata = { title: "Create event" };
export const dynamic = "force-dynamic";

/**
 * The one visible create-event entry point.
 *
 * Event creation is organization-scoped, so this route must never guess which
 * workspace a multi-organization customer meant or fall back to the legacy
 * global event form. A single eligible membership can continue immediately;
 * multiple memberships require an explicit choice; reviewer-only accounts get
 * a useful recovery state. Every successful choice enters the same guided
 * onboarding flow used immediately after signup.
 */
export default async function Page() {
  const identity = await getAdminSession();
  if (!identity) redirect("/login?next=%2Fevents%2Fnew");

  const memberships = (await listOrganizationsForUser(identity.userId))
    .filter(({ role }) => roleSatisfies(role, "organizer"));
  const [only] = memberships;
  if (memberships.length === 1 && only) {
    redirect(`/organizations/${only.organization.id}/onboarding`);
  }

  return (
    <main className="events-index">
      <header className="events-index-header">
        <Brand dark />
        <Link href="/events" className="header-help" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ArrowLeft size={14} /> Back to events
        </Link>
      </header>
      <section className="events-index-content">
        <div className="events-title">
          <div>
            <div className="page-eyebrow">Workspace</div>
            <h1>Create event</h1>
            <p>{memberships.length > 1
              ? "Choose the workspace that should own this event."
              : "You need owner or organizer access to create an event."}</p>
          </div>
        </div>
        {memberships.length > 1 ? <div className="event-grid">
          {memberships.map(({ organization, role }) => (
            <Link key={organization.id} href={`/organizations/${organization.id}/onboarding`} className="panel settings-section org-picker-card">
              <span className="metric-icon accent"><Building2 size={20} /></span>
              <span>
                <b>{organization.name}</b>
                <small>/{organization.slug} · {role}</small>
              </span>
            </Link>
          ))}
        </div> : <EmptyState
          icon={<Building2 size={22} />}
          title="No workspace can create events"
          description="Ask a workspace owner to make you an organizer, then come back here."
          action={<Link href="/organizations" className="button button-secondary">View your workspaces</Link>}
        />}
      </section>
    </main>
  );
}
