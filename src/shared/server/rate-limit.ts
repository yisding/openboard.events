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
 * Best-effort by design: two concurrent requests can each read the
 * pre-increment count and both land under the limit (`onConflictDoUpdate`
 * is one statement, but two racing upserts still each see their own
 * `RETURNING` row rather than serializing against each other the way a
 * `SELECT … FOR UPDATE` would). That is an acceptable slop of one for an
 * abuse guard, not a correctness invariant — nothing downstream depends on
 * the count being exact under contention.
 */
export async function checkRateLimit(dbOrTx: DbOrTx, args: { key: string; limit: number; windowMs: number }): Promise<void> {
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
    throw new AppError("RATE_LIMITED", "Too many requests. Please try again shortly.");
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
