import { z } from "zod";
import type { RuntimeEnv } from "@/shared/lib/env";
import { fromBase64Url, randomBytes, toBase64Url } from "@/shared/lib/crypto";

export const OAUTH_SIGNUP_INTENT_COOKIE = "openboard_oauth_signup";
export const OAUTH_SIGNUP_INTENT_SECONDS = 10 * 60;

const VERSION = 1;
const NONCE_LENGTH = 12;
const KEY_INFO = "oauth_signup_intent-v1";
const AAD = new TextEncoder().encode(OAUTH_SIGNUP_INTENT_COOKIE);

const versionSchema = z.string().trim().min(1).max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/iu);

const intentSchema = z.object({
  provider: z.literal("google"),
  organizationName: z.string().trim().min(1).max(160).optional(),
  invitationToken: z.string().trim().min(1).max(512).optional(),
  legalVersions: z.object({
    termsVersion: versionSchema,
    privacyVersion: versionSchema,
  }).nullable(),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
}).superRefine((intent, context) => {
  if (Boolean(intent.organizationName) === Boolean(intent.invitationToken)) {
    context.addIssue({
      code: "custom",
      message: "OAuth signup must name a workspace or carry one invitation",
    });
  }
  if (intent.expiresAt <= intent.issuedAt) {
    context.addIssue({ code: "custom", path: ["expiresAt"], message: "must follow issuedAt" });
  }
});

export type OAuthSignupIntent = z.infer<typeof intentSchema>;
export type NewOAuthSignupIntent = Omit<OAuthSignupIntent, "issuedAt" | "expiresAt">;

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function intentKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new ArrayBuffer(0), info: new TextEncoder().encode(KEY_INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

/**
 * Encrypt the signup-only context that must survive the Google redirect.
 *
 * In particular, an invitation is a bearer credential. It must never travel
 * as readable JSON in OAuth state, browser storage, or a query parameter. The
 * cookie carrying this envelope is HttpOnly and scoped to Google's callback;
 * AES-GCM also makes the contents confidential and tamper-evident.
 */
export async function sealOAuthSignupIntent(
  input: NewOAuthSignupIntent,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const intent = intentSchema.parse({
    ...input,
    issuedAt: now,
    expiresAt: now + OAUTH_SIGNUP_INTENT_SECONDS * 1000,
  });
  const nonce = randomBytes(NONCE_LENGTH);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asArrayBuffer(nonce), additionalData: asArrayBuffer(AAD) },
    await intentKey(secret, ["encrypt"]),
    new TextEncoder().encode(JSON.stringify(intent)),
  );
  const envelope = new Uint8Array(1 + NONCE_LENGTH + ciphertext.byteLength);
  envelope[0] = VERSION;
  envelope.set(nonce, 1);
  envelope.set(new Uint8Array(ciphertext), 1 + NONCE_LENGTH);
  return toBase64Url(envelope);
}

/** Invalid, stale, or differently keyed intents fail closed without leaking why. */
export async function openOAuthSignupIntent(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<OAuthSignupIntent | null> {
  try {
    const envelope = fromBase64Url(token);
    if (envelope[0] !== VERSION || envelope.length <= 1 + NONCE_LENGTH + 16) return null;
    const nonce = envelope.slice(1, 1 + NONCE_LENGTH);
    const ciphertext = envelope.slice(1 + NONCE_LENGTH);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(nonce), additionalData: asArrayBuffer(AAD) },
      await intentKey(secret, ["decrypt"]),
      asArrayBuffer(ciphertext),
    );
    const intent = intentSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
    return intent.issuedAt <= now && intent.expiresAt > now ? intent : null;
  } catch {
    return null;
  }
}

export function oauthSignupIntentCookieOptions(
  env: Pick<RuntimeEnv, "APP_ENV">,
): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: env.APP_ENV !== "local",
    sameSite: "lax",
    path: "/api/auth/callback/google",
    maxAge: OAUTH_SIGNUP_INTENT_SECONDS,
  };
}
