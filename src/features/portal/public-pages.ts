/**
 * The portal pages a signed-out visitor must be able to reach: the sign-in
 * flow, and the unsubscribe link mailed with every reminder — its token is the
 * authorization, and the recipient is by definition not signed in.
 *
 * Both gates (the middleware and the portal layout) ask this one function, so
 * they cannot drift apart and start redirecting each other.
 */
export function isPublicPortalPage(pathname: string, portalRoot: string): boolean {
  return PUBLIC_PORTAL_SUFFIXES.some((suffix) => pathname === `${portalRoot}${suffix}`);
}

const PUBLIC_PORTAL_SUFFIXES = ["/login", "/verify", "/unsubscribe", "/unsubscribe/confirm"] as const;
