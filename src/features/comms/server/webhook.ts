import { z } from "zod";
import { safeEqual } from "@/features/auth/server/crypto";
import type { SuppressionReason } from "@/shared/contracts";

/**
 * Resend's outbound webhooks are signed by Svix (the same scheme Svix's own
 * webhook customers verify against): `svix-id`/`svix-timestamp`/
 * `svix-signature` headers, secret shaped `whsec_<base64>`, signed content
 * `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 over that content, standard
 * (not url-safe) base64 output. `svix-signature` may carry several
 * space-separated `v{n},<sig>` entries (key rotation); any `v1` match
 * verifies the request. A 5-minute timestamp tolerance guards against replay
 * of a captured, still-valid-looking payload.
 */
const TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function hmacSha256Base64(secretBytes: Uint8Array, content: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secretBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyResendWebhookSignature(args: {
  id: string;
  timestamp: string;
  signature: string;
  body: string;
  secret: string;
}): Promise<boolean> {
  const timestampSeconds = Number(args.timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > TOLERANCE_SECONDS) return false;

  const secretBody = args.secret.startsWith("whsec_") ? args.secret.slice("whsec_".length) : args.secret;
  let secretBytes: Uint8Array;
  try {
    secretBytes = base64ToBytes(secretBody);
  } catch {
    return false;
  }
  const expected = await hmacSha256Base64(secretBytes, `${args.id}.${args.timestamp}.${args.body}`);
  return args.signature.split(/\s+/u).some((entry) => {
    const [version, signature] = entry.split(",");
    return version === "v1" && typeof signature === "string" && signature.length > 0 && safeEqual(signature, expected);
  });
}

const resendWebhookEventSchema = z.object({
  type: z.string(),
  data: z.object({ email_id: z.string().min(1) }),
});

/**
 * Only bounce/complaint events map to a suppression reason; every other
 * Resend event type (`email.sent`, `.delivered`, `.opened`, `.clicked`, …)
 * is recognized-but-ignored — `null` here, not an error, so the route
 * answers `200` for the full event catalog Resend may add later without a
 * redeploy.
 */
export function parseResendWebhookEvent(rawBody: string): { emailId: string; reason: SuppressionReason } | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const parsed = resendWebhookEventSchema.safeParse(payload);
  if (!parsed.success) return null;
  const reason: SuppressionReason | null = parsed.data.type === "email.bounced"
    ? "bounce"
    : parsed.data.type === "email.complained"
      ? "complaint"
      : null;
  return reason ? { emailId: parsed.data.data.email_id, reason } : null;
}
