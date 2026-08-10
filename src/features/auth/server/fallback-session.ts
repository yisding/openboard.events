import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { userIdSchema, type UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { randomBytes, toBase64Url } from "./crypto";
import { verifyAdminPassword } from "./admin-password";

export { ADMIN_COOKIE } from "../cookies";
export const ADMIN_SESSION_SECONDS = 7 * 24 * 60 * 60;
const PBKDF2_ITERATIONS = 100_000;
const jwtPayloadSchema = z.object({
  userId: userIdSchema,
  email: z.email(),
  name: z.string(),
});

export type AdminIdentity = z.infer<typeof jwtPayloadSchema>;

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function configuredSecret(): string {
  const secret = getEnv().SESSION_SECRET;
  if (!secret) throw new AppError("INTERNAL", "SESSION_SECRET is required for admin authentication");
  return secret;
}

export async function hashPassword(password: string, salt = randomBytes(16)): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: asArrayBuffer(salt), iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`;
}

/**
 * Verify a `users.password_hash` value.
 *
 * Delegates to `verifyAdminPassword`, which understands *both* PBKDF2 schemes
 * — the legacy `pbkdf2-sha256$…` this module's own `hashPassword` writes, and
 * the `pbkdf2-sha256-v2$…` scheme Better Auth writes. That matters because
 * `mirrorCredentialToFallback` (`better-auth.ts`) copies a Better Auth
 * password back into `users.password_hash` after a reset/signup/change, so the
 * column now legitimately holds v2 values. A verifier pinned to the legacy
 * literal would read every one of them as "wrong password" and lock the user
 * out the moment `ADMIN_AUTH_PROVIDER` flipped back to `fallback` — the exact
 * failure the mirror exists to prevent.
 *
 * Both schemes keep the same 100,000-iteration floor (`verifyAdminPassword`
 * refuses a legacy hash claiming fewer), so this widens the accepted encoding,
 * not the work factor.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  return verifyAdminPassword({ hash: encoded, password });
}

export async function signAdminToken(identity: AdminIdentity, secret = configuredSecret()): Promise<string> {
  return new SignJWT(identity)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_SECONDS}s`)
    .sign(secretKey(secret));
}

export async function verifyAdminToken(token: string, secret = configuredSecret()): Promise<AdminIdentity | null> {
  try {
    const verified = await jwtVerify(token, secretKey(secret), { algorithms: ["HS256"] });
    return jwtPayloadSchema.parse(verified.payload);
  } catch {
    return null;
  }
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: getEnv().APP_ENV !== "local",
    sameSite: "lax" as const,
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  };
}

export function asUserId(value: string): UserId {
  return userIdSchema.parse(value);
}
