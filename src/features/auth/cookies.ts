export const PORTAL_COOKIE_PREFIX = "ob_portal_";

/**
 * Better Auth session cookie names.
 *
 * Better Auth is configured with `advanced.cookiePrefix: "openboard_admin"`
 * (`server/better-auth.ts`), so its session cookie is
 * `openboard_admin.session_token`, and `useSecureCookies` (everything but
 * `APP_ENV=local`) prepends the `__Secure-` prefix. Both names are listed here
 * because `useSecureCookies` changes the name outside local development.
 */
const BETTER_AUTH_COOKIE_PREFIX = "openboard_admin";
const BETTER_AUTH_SESSION_COOKIE = `${BETTER_AUTH_COOKIE_PREFIX}.session_token`;
export const ADMIN_SESSION_COOKIES: readonly string[] = [
  BETTER_AUTH_SESSION_COOKIE,
  `__Secure-${BETTER_AUTH_SESSION_COOKIE}`,
];

/** True when a Better Auth admin session cookie is present. */
export function hasAdminSessionCookie(names: Iterable<string>): boolean {
  for (const name of names) {
    if (ADMIN_SESSION_COOKIES.includes(name)) return true;
  }
  return false;
}
