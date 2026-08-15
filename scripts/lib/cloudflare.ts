/**
 * One Cloudflare REST client for the deploy-path scripts.
 *
 * `manage-dmarc.ts` and `ensure-r2-staging-lifecycle.ts` each carried their own
 * `cloudflareRequest`, and between them they had drifted on the two things that
 * matter when a deploy fails at 3am: whether a `success: true` envelope with no
 * `result` counts as success, and what the thrown message says. Neither
 * difference was intentional — the lifecycle copy simply predates the DMARC one
 * — but a shared helper that quietly picked one of the two behaviours would
 * change the other script's contract, so `expectResult` keeps both callers on
 * exactly the semantics they were written against.
 *
 * `check-worker-bootstrap.ts` deliberately does NOT go through `cloudflareRequest`:
 * it reads the raw HTTP status because a 404 is its success case, and unwrapping
 * the envelope would throw on precisely the response it needs to see. It shares
 * the base URL and the credential read, which is all it ever had in common.
 */

export const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";

export type CloudflareError = { code?: number; message?: string };

export type CloudflareEnvelope<T> = {
  success: boolean;
  result?: T;
  errors?: CloudflareError[];
};

/** `path` is relative to `/client/v4/` and must already be component-encoded. */
export function cloudflareApiUrl(path: string): URL {
  return new URL(`/client/v4/${path}`, CLOUDFLARE_API_ORIGIN);
}

export type CloudflareCredentials = { accountId: string; apiToken: string };

/**
 * Both variables or neither — a half-configured environment must fail before
 * the first request, not with a 401 that reads like a Cloudflare outage.
 * `purpose` is appended so each script keeps its own diagnostic.
 */
export function requireCloudflareCredentials(purpose?: string): CloudflareCredentials {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    throw new Error(`CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required${purpose ? ` ${purpose}` : ""}`);
  }
  return { accountId, apiToken };
}

export async function cloudflareRequest<T>(
  apiToken: string,
  path: string,
  init?: RequestInit & {
    /** Treat a `success: true` envelope carrying no `result` as a failure. */
    expectResult?: boolean;
    /** Overrides the thrown message's prefix so callers keep their own wording. */
    failureLabel?: string;
  },
): Promise<T> {
  const { expectResult = true, failureLabel = "Cloudflare API request failed", ...requestInit } = init ?? {};
  const response = await fetch(cloudflareApiUrl(path), {
    ...requestInit,
    headers: {
      authorization: `Bearer ${apiToken}`,
      ...(requestInit.body === undefined ? {} : { "content-type": "application/json" }),
      ...requestInit.headers,
    },
  });
  const payload = await response.json().catch(() => null) as CloudflareEnvelope<T> | null;
  if (!response.ok || !payload?.success || (expectResult && payload.result === undefined)) {
    const errors = payload?.errors?.map((error) => `${error.code ?? "unknown"}: ${error.message ?? "unknown"}`).join(", ");
    throw new Error(`${failureLabel} (${response.status})${errors ? `: ${errors}` : ""}`);
  }
  return payload.result as T;
}
