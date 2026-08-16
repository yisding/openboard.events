const INTERNAL_ORIGIN = "https://openboard.invalid";
type RedirectValue = string | readonly string[] | null | undefined;

export function safeInternalPath(value: RedirectValue, fallback = "/events"): string {
  // Repeated query parameters are ambiguous and arrive from Next.js as an
  // array. Reject them instead of choosing an attacker-controlled element.
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  // A literal backslash or a control character is unsafe wherever it appears.
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/u.test(value)) return fallback;
  try {
    const parsed = new URL(value, INTERNAL_ORIGIN);
    if (parsed.origin !== INTERNAL_ORIGIN) return fallback;
    // An encoded slash or backslash smuggles a protocol-relative URL past the
    // `//` check above — but only from path position. Scanning the whole string
    // also condemned `?next=%2Fportal%2Fx%2Fprofile`, the shape our own portal
    // login redirect generates, which turned every portal deep link into an
    // infinite redirect.
    if (/%(?:2f|5c)/iu.test(parsed.pathname)) return fallback;
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    // WHATWG dot-segment normalization can turn `/.//host` into `//host`
    // even though the original string passed the protocol-relative check.
    if (normalized.startsWith("//")) return fallback;
    return normalized;
  } catch {
    return fallback;
  }
}

/** Build an auth-route handoff without ever reflecting an external `next` URL. */
export function authPathWithNext(path: string, value: RedirectValue): string {
  const next = safeInternalPath(value, "");
  return next ? `${path}?${new URLSearchParams({ next }).toString()}` : path;
}

const GOOGLE_SIGNUP_PARAM = "provider";
const GOOGLE_SIGNUP_VALUE = "google";

/**
 * The `/signup` handoff that opens the Google step straight away. Sign-in
 * deliberately never creates an account, so a Google address nobody has signed
 * up with yet is sent here instead of being told no.
 */
export function googleSignupPath(value: RedirectValue): string {
  const next = safeInternalPath(value, "");
  const params = new URLSearchParams(next ? { next } : {});
  params.set(GOOGLE_SIGNUP_PARAM, GOOGLE_SIGNUP_VALUE);
  return `/signup?${params.toString()}`;
}

/** Whether `/signup` was reached from that handoff. */
export function requestsGoogleSignup(params: Pick<URLSearchParams, "get">): boolean {
  return params.get(GOOGLE_SIGNUP_PARAM) === GOOGLE_SIGNUP_VALUE;
}

/** Continue an existing session without reflecting unsafe or looping auth routes. */
export function authenticatedAuthDestination(
  value: RedirectValue,
  fallback = "/organizations",
): string {
  const next = safeInternalPath(value, "");
  if (!next) return fallback;
  const pathname = new URL(next, INTERNAL_ORIGIN).pathname;
  if (
    pathname === "/login"
    || pathname.startsWith("/login/")
    || pathname === "/signup"
    || pathname.startsWith("/signup/")
  ) return fallback;
  return next;
}
