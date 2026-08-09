import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { userIdSchema, type UserId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";
import { fromBase64Url, randomBytes, safeEqual, toBase64Url } from "./crypto";

export { ADMIN_COOKIE } from "../cookies";
export const ADMIN_SESSION_SECONDS = 7 * 24 * 60 * 60;
const PBKDF2_ITERATIONS = 100_000;
const passwordHashSchema = z.tuple([
  z.literal("pbkdf2-sha256"),
  z.coerce.number().int().min(PBKDF2_ITERATIONS),
  z.string().min(1),
  z.string().min(1),
]);
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

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = passwordHashSchema.safeParse(encoded.split("$"));
  if (!parsed.success) return false;
  const [, iterations, salt, expected] = parsed.data;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: asArrayBuffer(fromBase64Url(salt)), iterations },
    key,
    256,
  );
  return safeEqual(toBase64Url(new Uint8Array(bits)), expected);
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
