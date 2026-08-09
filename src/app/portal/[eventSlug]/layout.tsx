import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requirePortal } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { PortalRouteShell } from "@/features/portal/portal-route-shell";
import { isAppError } from "@/shared/lib/errors";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const portalRoot = `/portal/${encodeURIComponent(eventSlug)}`;
  const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), portalRoot);
  const pathname = new URL(requestPath, "https://openboard.invalid").pathname;
  const isAuthPage = pathname === `${portalRoot}/login` || pathname === `${portalRoot}/verify`;
  if (!isAuthPage) {
    try {
      await requirePortal(eventSlug);
    } catch (error) {
      if (!isAppError(error)) throw error;
      if (error.code === "NOT_FOUND") notFound();
      if (error.code === "UNAUTHORIZED") redirect(`${portalRoot}/login?next=${encodeURIComponent(requestPath)}`);
      throw error;
    }
  }
  return <PortalRouteShell eventSlug={eventSlug}>{children}</PortalRouteShell>;
}
