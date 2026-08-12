import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Brand } from "@/shared/ui/brand";
import { getAdminSession } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";

/**
 * M44 — the organization-scoped surfaces (team, audit log). Same gate shape
 * as `app/events/layout.tsx`: signed-in-at-all is checked here so every page
 * underneath does not repeat it; the organization-specific role check
 * (`requireOrganizationAdmin`) still happens per page, because *which* role
 * is required differs by page in a way this shared layout does not know.
 */
export default async function OrganizationLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAdminSession())) {
    const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), "/organizations");
    redirect(`/login?next=${encodeURIComponent(requestPath)}`);
  }
  return <main className="events-index">
    <header className="events-index-header">
      <Brand dark />
      <Link href="/events" className="header-help" style={{ display: "flex", alignItems: "center", gap: 6 }}>Back to events</Link>
    </header>
    <section className="events-index-content">{children}</section>
  </main>;
}
