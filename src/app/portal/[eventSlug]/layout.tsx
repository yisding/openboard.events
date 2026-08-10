import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requirePortal, type PortalSession } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { PortalRouteShell } from "@/features/portal/portal-route-shell";
import { getPortalShellData, type PortalShellData } from "@/features/portal/server/shell";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { isAppError } from "@/shared/lib/errors";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const portalRoot = `/portal/${encodeURIComponent(eventSlug)}`;
  const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), portalRoot);
  const pathname = new URL(requestPath, "https://openboard.invalid").pathname;
  const isAuthPage = pathname === `${portalRoot}/login` || pathname === `${portalRoot}/verify`;
  let session: PortalSession | null = null;
  // The chrome's event/speaker come from this server read. The demo fixture the
  // provider falls back to has neither a real event slug nor a real contact, so
  // resolving them there 404s every surface for a genuinely signed-in speaker.
  let shell: PortalShellData | undefined;
  if (!isAuthPage && !isCredentialFreeLocalDemo()) {
    try {
      session = await requirePortal(eventSlug);
    } catch (error) {
      if (!isAppError(error)) throw error;
      if (error.code === "NOT_FOUND") notFound();
      if (error.code === "UNAUTHORIZED") redirect(`${portalRoot}/login?next=${encodeURIComponent(requestPath)}`);
      throw error;
    }
    shell = await getPortalShellData(session.eventId, session.contactId) ?? undefined;
    // A live session whose event or contact row is gone is a signed-out user.
    if (!shell) redirect(`${portalRoot}/login?next=${encodeURIComponent(requestPath)}`);
  }
  return <PortalRouteShell eventSlug={eventSlug} session={session} {...(shell ? { shell } : {})}>{children}</PortalRouteShell>;
}
