export type PortalAuthData = {
  alreadySignedIn?: boolean;
  fallback?: { otp: string; magicLink: string };
  message?: string;
};

export type PortalAuthRequestResult =
  | { ok: true; data: PortalAuthData }
  | { ok: false; status: number | null; message: string };

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
    return {
      ok: false,
      status: response.status,
      message: payload?.error?.message ?? "The request could not be completed",
    };
  }
  return { ok: true, data: payload.data };
}
