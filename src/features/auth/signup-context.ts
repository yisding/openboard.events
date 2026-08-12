export const SIGNUP_ORGANIZATION_HEADER = "x-openboard-signup-organization-id";

const INTERNAL_ORIGIN = "https://openboard.invalid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

/**
 * Extract the invitation bearer token only from the supported `/join` return
 * path. Callers run the path through `safeInternalPath` first; this second,
 * narrow check keeps unrelated `next` query strings out of the auth request.
 */
export function invitationTokenFromNextPath(next: string): string | null {
  try {
    const url = new URL(next, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN || url.pathname !== "/join") return null;
    const token = url.searchParams.get("token")?.trim() ?? "";
    return token.length > 0 && token.length <= 512 ? token : null;
  } catch {
    return null;
  }
}

/** The new-account hook returns the invited organization without exposing it in the response body. */
export function signupDestination(next: string, invitedOrganizationId: string | null): string {
  const organizationId = invitedOrganizationId?.trim() ?? "";
  return UUID.test(organizationId)
    ? `/organizations/${encodeURIComponent(organizationId)}`
    : next;
}
