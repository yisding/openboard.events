import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requirePortal, type PortalSession } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { PortalRouteShell } from "@/features/portal/portal-route-shell";
import { isPublicPortalPage } from "@/features/portal/public-pages";
import { getPortalShellData, type PortalShellData } from "@/features/portal/server/shell";
import { isAppError } from "@/shared/lib/errors";

/** Not a path: `safeInternalPath` only ever returns this or a string starting with "/". */
const UNKNOWN_REQUEST_PATH = "unknown";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const portalRoot = `/portal/${encodeURIComponent(eventSlug)}`;
  // `safeInternalPath` either vouches for a path or falls back to a different
  // one, so reading its fallback as "the current page" is a lie — and the lie
  // that made the login page look protected, redirect to itself, and loop
  // forever. Unknown stays unknown: the gate below only runs when we know
  // which page this is, because a layout must never be able to redirect to a
  // URL that re-renders that same layout in the same state. Every portal page
  // guards itself through `requirePortalContext`, so nothing is exposed.
  const requestPath = safeInternalPath((await headers()).get("x-openboard-request-path"), UNKNOWN_REQUEST_PATH);
  const pathname = requestPath === UNKNOWN_REQUEST_PATH ? null : new URL(requestPath, "https://openboard.invalid").pathname;
  const isPublicPage = pathname === null || isPublicPortalPage(pathname, portalRoot);
  let session: PortalSession | null = null;
  // The chrome's event/speaker come from this server read, keyed by the session
  // the guard below vouches for.
  let shell: PortalShellData | undefined;
  if (!isPublicPage) {
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
  // A public page has no session to hang the portal chrome on and brings its
  // own full-page layout — `PortalRouteShell` already did this for /login and
  // /verify, and `PortalProvider` 404s when asked to render without a shell.
  if (isPublicPage) return <>{children}</>;
  return <PortalRouteShell eventSlug={eventSlug} session={session} {...(shell ? { shell } : {})}>{children}</PortalRouteShell>;
}
