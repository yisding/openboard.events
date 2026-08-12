import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Brand } from "@/shared/ui/brand";
import { getAdminSession } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";

/** M44 — self-service account surfaces (currently: sessions). Same signed-in gate as `app/events/layout.tsx`. */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  if (!(await getAdminSession())) {
    const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), "/account/sessions");
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
