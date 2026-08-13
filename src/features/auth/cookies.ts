export const ADMIN_COOKIE = "ob_admin";
export const PORTAL_COOKIE_PREFIX = "ob_portal_";

/**
 * M42 — the cookie names the *other* admin provider issues.
 *
 * Better Auth is configured with `advanced.cookiePrefix: "openboard_admin"`
 * (`server/better-auth.ts`), so its session cookie is
 * `openboard_admin.session_token`, and `useSecureCookies` (everything but
 * `APP_ENV=local`) prepends the `__Secure-` prefix. Both names are listed here
 * because the edge middleware cannot read `ADMIN_AUTH_PROVIDER` — it has no
 * Cloudflare context and `process.env` is off-limits in `src/` — so its gate
 * has to recognise *either* provider's cookie rather than pick one.
 *
 * Recognising both is also the right shape on its own terms: the middleware is
 * a redirect-to-login convenience, never the authorization decision (that is
 * `requireAdmin`, which reads exactly one provider's storage). Being generous
 * here costs a wasted round trip for a stale cookie; being narrow costs an
 * infinite `/events → /login → /events` redirect loop for a signed-in admin,
 * which is what happened while only `ADMIN_COOKIE` was checked.
 */
const BETTER_AUTH_COOKIE_PREFIX = "openboard_admin";
const BETTER_AUTH_SESSION_COOKIE = `${BETTER_AUTH_COOKIE_PREFIX}.session_token`;
export const ADMIN_SESSION_COOKIES: readonly string[] = [
  ADMIN_COOKIE,
  BETTER_AUTH_SESSION_COOKIE,
  `__Secure-${BETTER_AUTH_SESSION_COOKIE}`,
];

/** True when any admin provider's session cookie is present. */
export function hasAdminSessionCookie(names: Iterable<string>): boolean {
  for (const name of names) {
    if (ADMIN_SESSION_COOKIES.includes(name)) return true;
  }
  return false;
}
