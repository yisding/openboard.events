import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getPortalImpersonator, requirePortal, type PortalSession } from "@/features/auth";
import { safeInternalPath } from "@/features/auth/safe-next";
import { PortalRouteShell } from "@/features/portal/portal-route-shell";
import { isPublicPortalPage } from "@/features/portal/public-pages";
import { getPortalShellData } from "@/features/portal/server/shell";
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
  // A public page has no session to hang the portal chrome on and brings its
  // own full-page layout — `PortalRouteShell` already did this for /login and
  // /verify, and `PortalProvider` cannot render without a shell at all.
  if (isPublicPage) return <>{children}</>;

  let session: PortalSession;
  try {
    session = await requirePortal(eventSlug);
  } catch (error) {
    if (!isAppError(error)) throw error;
    if (error.code === "NOT_FOUND") notFound();
    if (error.code === "UNAUTHORIZED") redirect(`${portalRoot}/login?next=${encodeURIComponent(requestPath)}`);
    throw error;
  }
  // The chrome's event/speaker come from this server read, keyed by the session
  // the guard above vouched for.
  const shell = await getPortalShellData(session.eventId, session.contactId);
  // A live session whose event or contact row is gone is a signed-out user.
  if (!shell) redirect(`${portalRoot}/login?next=${encodeURIComponent(requestPath)}`);
  // Only read for an impersonated session, so an ordinary speaker's page never
  // pays for a lookup that would always come back null.
  const impersonator = session.impersonatedByUserId ? await getPortalImpersonator(session.impersonatedByUserId) : null;
  return <PortalRouteShell session={session} shell={shell} impersonator={impersonator}>{children}</PortalRouteShell>;
}
