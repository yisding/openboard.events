import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { type DbOrTx } from "@/db/client";
import { rateLimitBuckets } from "@/db/schema";
import { AppError } from "@/shared/lib/errors";

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(key));
  return toBase64Url(new Uint8Array(digest));
}

/**
 * A single hashed-key fixed-window counter, shared by every caller (public
 * submit path, `/api/v1`) instead of one bespoke table per route — same
 * single-statement CASE-upsert discipline as `registerLoginAttempt`
 * (`features/auth/server/admin.ts`), so no ninth `withTx` path is needed
 * (PLAN resolution 4). The window slides forward from whichever request
 * first lands inside it: once `windowMs` has fully elapsed since that first
 * request, the next request opens a fresh window rather than waiting for a
 * fixed clock-aligned boundary.
 *
 * PostgreSQL serializes conflicting `INSERT ... ON CONFLICT DO UPDATE`
 * statements on the unique key. Each update therefore evaluates against the
 * latest row and returns its own post-increment count; a concurrent burst does
 * not get a free request per caller. The integration suite locks this behavior
 * down because credential capacity protection relies on the atomic counter.
 *
 * Rows are not self-expiring: this upsert only ever writes, so the daily
 * retention sweep (`features/data-lifecycle/server/retention.ts`) deletes
 * buckets idle for longer than any window in use. Without it the table would
 * grow one permanent row per distinct key — and the keys public callers
 * supply hash an IP address (`/api/v1`, portal login request), which is not
 * something to retain forever.
 */
export async function checkRateLimit(
  dbOrTx: DbOrTx,
  /**
   * `message` replaces the generic refusal for callers whose 429 is read by a
   * person mid-flow. The portal sign-in form says "Check your inbox, or try
   * again in a few minutes" — the same sentence its per-contact throttle
   * already used, so which of the two fired is not something the screen
   * reports.
   */
  args: { key: string; limit: number; windowMs: number; message?: string },
): Promise<void> {
  const keyHash = await hashKey(args.key);
  const now = new Date();
  const windowCutoff = new Date(now.getTime() - args.windowMs);
  const [bucket] = await dbOrTx.insert(rateLimitBuckets)
    .values({ keyHash, count: 1, windowStartedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: rateLimitBuckets.keyHash,
      set: {
        count: sql<number>`CASE WHEN ${rateLimitBuckets.windowStartedAt} > ${windowCutoff} THEN ${rateLimitBuckets.count} + 1 ELSE 1 END`,
        windowStartedAt: sql<Date>`CASE WHEN ${rateLimitBuckets.windowStartedAt} > ${windowCutoff} THEN ${rateLimitBuckets.windowStartedAt} ELSE ${now} END`,
        updatedAt: now,
      },
    })
    .returning();
  if ((bucket?.count ?? 0) > args.limit) {
    // The refused request already told us when its window opened, so the reset
    // is arithmetic rather than a guess. `errorEnvelope` publishes it as
    // `Retry-After`; floored at one second because a `Retry-After: 0` reads as
    // "retry immediately", which is the one thing a refused caller must not do.
    const windowStartedAt = bucket?.windowStartedAt ?? now;
    const msUntilReset = new Date(windowStartedAt).getTime() + args.windowMs - now.getTime();
    const retryAfterSeconds = Math.max(1, Math.ceil(msUntilReset / 1000));
    throw new AppError(
      "RATE_LIMITED",
      args.message ?? "Too many requests. Please try again shortly.",
      { retryAfterSeconds },
    );
  }
}

/**
 * The trusted client IP, Cloudflare-first. `cf-connecting-ip` is stamped by
 * Cloudflare's edge and cannot be spoofed by the caller; `x-forwarded-for`
 * is a local/non-Cloudflare fallback only (its leftmost entry is
 * caller-supplied and untrusted, but there is no better signal off-platform).
 */
export function clientIp(request: NextRequest | Request): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}
