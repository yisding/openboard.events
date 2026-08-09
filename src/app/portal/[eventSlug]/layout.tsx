import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requirePortal } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { PortalRouteShell } from "@/features/portal/portal-route-shell";
import { isAppError } from "@/shared/lib/errors";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), `/portal/${eventSlug}`);
  const pathname = requestPath.split("?", 1)[0];
  const isAuthPage = pathname === `/portal/${eventSlug}/login` || pathname === `/portal/${eventSlug}/verify`;
  if (!isAuthPage) {
    try {
      await requirePortal(eventSlug);
    } catch (error) {
      if (!isAppError(error)) throw error;
      if (error.code === "UNAUTHORIZED") {
        redirect(`/portal/${eventSlug}/login?next=${encodeURIComponent(requestPath)}`);
      }
      if (error.code === "NOT_FOUND") notFound();
      throw error;
    }
  }
  return <PortalRouteShell eventSlug={eventSlug}>{children}</PortalRouteShell>;
}
