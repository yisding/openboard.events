export type PortalAuthData = {
  alreadySignedIn?: boolean;
  fallback?: { otp: string; magicLink: string };
  message?: string;
};

export type PortalAuthRequestResult =
  | { ok: true; data: PortalAuthData }
  | { ok: false; status: number | null; message: string; retryAfterSeconds?: number };

/**
 * Seconds until a refused request may be repeated, as the limiter itself
 * measured them. A throttled speaker is told "try again in a few minutes" by
 * the wire message; the header is what lets the screen say *how many*.
 */
function retryAfterSeconds(response: Response): number | undefined {
  // Optional detail, read defensively: this helper exists to make a refusal
  // more precise, and nothing about it may turn a refusal the caller can
  // already handle into a thrown one. `?.` because a `fetch` stubbed with a
  // response-shaped object — several suites do — has no `headers` at all.
  const header = response.headers?.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

/**
 * Portal sign-in is often used from a phone on an unreliable connection. Keep
 * transport failures as ordinary results so every step can restore its button
 * and let the speaker retry without losing the email or code they entered.
 */
export async function portalAuthRequest(path: string, body: unknown): Promise<PortalAuthRequestResult> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: null, message: "Could not reach the server" };
  }

  const payload = await response.json().catch(() => null) as {
    data?: PortalAuthData;
    error?: { message?: string };
  } | null;
  if (!response.ok || !payload?.data) {
    const retryAfter = retryAfterSeconds(response);
    return {
      ok: false,
      status: response.status,
      message: payload?.error?.message ?? "The request could not be completed",
      ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
    };
  }
  return { ok: true, data: payload.data };
}
