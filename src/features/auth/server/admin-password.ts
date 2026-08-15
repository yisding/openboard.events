import { z } from "zod";
import { fromBase64Url, randomBytes, safeEqual, toBase64Url } from "@/shared/lib/crypto";
import { log } from "@/shared/lib/log";

/**
 * M42 AC 1 — Better Auth's custom password-hashing hooks.
 *
 * Two schemes can live side by side in `admin_accounts.password` during the
 * credential migration window:
 *
 * - `pbkdf2-sha256$<iterations>$<salt>$<hash>` — the **legacy** scheme copied
 *   verbatim from the retired `users.password_hash` store by
 *   `drizzle/0009_product_auth.sql`. Existing organizers are upgraded without
 *   a forced reset: the hash verifies and `needsRehash` marks it for replacement.
 * - `pbkdf2-sha256-v2$<iterations>$<salt>$<hash>` — the **current** scheme,
 *   written on every new password and on the first successful sign-in with a
 *   legacy hash (`better-auth.ts`'s post-sign-in hook).
 *
 * The work factor is deliberately unchanged at 100,000 iterations. Cloudflare
 * Workers' WebCrypto is the constraint here, not preference: existing hashes
 * use that number, and raising it is a separate, measured change. What v2 does
 * change is the salt (16 →
 * 32 bytes) and, more importantly, the *location*: the credential moves out of
 * `users.password_hash`, which every repository module can read, into
 * `admin_accounts`, which only the auth provider touches.
 *
 * scrypt (Better Auth's default) is not used: its pure-JS implementation is
 * CPU-bound in a Worker isolate, where PBKDF2 runs in native WebCrypto.
 */

const PBKDF2_ITERATIONS = 100_000;
const LEGACY_SCHEME = "pbkdf2-sha256";
const CURRENT_SCHEME = "pbkdf2-sha256-v2";
const CURRENT_SALT_BYTES = 32;

/**
 * The salt is the one part that gets *decoded* rather than compared, so it is
 * the one part whose encoding has to be validated here: `fromBase64Url` calls
 * `atob`, which throws on a character outside the alphabet, and that throw
 * would escape a function documented to answer `false`.
 *
 * `atob` itself is the acceptance test rather than a regex. The legacy rows
 * were copied verbatim out of `users.password_hash` by
 * `drizzle/0009_product_auth.sql`, so their alphabet is whatever that retired
 * writer used — a pattern tight enough to reject corruption would also reject
 * any of those carrying a `+` or `/`, which decode fine today. Asking the
 * decoder keeps the schema's answer and the runtime's answer identical by
 * construction.
 *
 * The digest needs no such check: it is only ever `safeEqual`'d as a string,
 * and an undecodable one simply never matches.
 */
const decodableSalt = z.string().min(1).refine((salt) => {
  try {
    fromBase64Url(salt);
    return true;
  } catch {
    return false;
  }
});

const encodedSchema = z.tuple([
  z.enum([LEGACY_SCHEME, CURRENT_SCHEME]),
  z.coerce.number().int().min(1).max(1_000_000),
  decodableSalt,
  z.string().min(1),
]);

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: asArrayBuffer(salt), iterations },
    key,
    256,
  );
  return toBase64Url(new Uint8Array(bits));
}

/** Hash a password in the current scheme. Better Auth's `password.hash` hook. */
export async function hashAdminPassword(password: string, salt = randomBytes(CURRENT_SALT_BYTES)): Promise<string> {
  const digest = await derive(password, salt, PBKDF2_ITERATIONS);
  return `${CURRENT_SCHEME}$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${digest}`;
}

/**
 * Verify against either scheme. Better Auth's `password.verify` hook.
 *
 * Unparseable input is a `false`, never a throw: a malformed row must read as
 * "wrong password" so it cannot be told apart from a real failure by timing or
 * by error shape. `encodedSchema` is what makes that true — every way a stored
 * string can be unreadable is a `safeParse` failure, including a salt `atob`
 * cannot decode.
 *
 * A throw out of the crypto itself is a different event and still propagates:
 * WebCrypto failing is not a credential outcome, and recording it as one would
 * turn an outage into a site-wide "wrong password".
 */
export async function verifyAdminPassword(args: { hash: string; password: string }): Promise<boolean> {
  const startedAt = performance.now();
  const requestId = `password:${crypto.randomUUID()}`;
  try {
    const parsed = encodedSchema.safeParse(args.hash.split("$"));
    if (!parsed.success) {
      log({
        level: "warn",
        msg: "auth.password_verification",
        requestId,
        feature: "auth",
        code: "malformed_hash",
        durationMs: Math.round(performance.now() - startedAt),
      });
      return false;
    }
    const [scheme, iterations, salt, expected] = parsed.data;
    // The legacy writer pinned its iteration count; refuse a stored hash that
    // claims a weaker one so a tampered row cannot downgrade the work factor.
    if (scheme === LEGACY_SCHEME && iterations < PBKDF2_ITERATIONS) {
      log({
        level: "warn",
        msg: "auth.password_verification",
        requestId,
        feature: "auth",
        code: "downgrade_rejected",
        durationMs: Math.round(performance.now() - startedAt),
      });
      return false;
    }
    const digest = await derive(args.password, fromBase64Url(salt), iterations);
    const accepted = safeEqual(digest, expected);
    log({
      level: "info",
      msg: "auth.password_verification",
      requestId,
      feature: "auth",
      code: accepted ? "accepted" : "rejected",
      durationMs: Math.round(performance.now() - startedAt),
    });
    return accepted;
  } catch (error) {
    log({
      level: "error",
      msg: "auth.password_verification",
      requestId,
      feature: "auth",
      code: "failed",
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
}

/**
 * True when a verified hash is still in the legacy scheme and should be
 * rewritten. Called only after a *successful* verification, which is the only
 * moment the plaintext is available to rehash with.
 */
export function needsRehash(hash: string): boolean {
  const parsed = encodedSchema.safeParse(hash.split("$"));
  if (!parsed.success) return false;
  return parsed.data[0] === LEGACY_SCHEME;
}
