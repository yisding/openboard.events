import { safeInternalPath } from "./safe-next";

/**
 * Better Auth gives the mail callback a provider URL whose reset token lives
 * in the path and whose requested UI destination lives in `callbackURL`.
 * Openboard emails its own reset page instead so the bearer value remains a
 * `token=` query parameter covered by auth-mail redaction. Preserve only the
 * safe `next` nested inside our one supported reset page.
 */
export function passwordResetLandingUrl(providerUrl: string, token: string): URL {
  const source = new URL(providerUrl);
  const destination = new URL("/login/reset", source.origin);
  const callbackPath = safeInternalPath(source.searchParams.get("callbackURL"), "/login/reset");
  const callback = new URL(callbackPath, source.origin);
  if (callback.pathname === "/login/reset") {
    const next = safeInternalPath(callback.searchParams.get("next"), "");
    if (next) destination.searchParams.set("next", next);
  }
  destination.searchParams.set("token", token);
  return destination;
}
