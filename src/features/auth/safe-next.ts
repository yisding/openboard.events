const INTERNAL_ORIGIN = "https://openboard.invalid";

export function safeInternalPath(value: string | null | undefined, fallback = "/events"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
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
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

/** Build an auth-route handoff without ever reflecting an external `next` URL. */
export function authPathWithNext(path: string, value: string | null | undefined): string {
  const next = safeInternalPath(value, "");
  return next ? `${path}?${new URLSearchParams({ next }).toString()}` : path;
}
