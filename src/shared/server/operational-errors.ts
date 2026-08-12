import { neon } from "@neondatabase/serverless";
import { getEnv } from "@/shared/lib/env";

export type OperationalErrorContext = {
  requestId: string;
  feature: string;
  eventId?: string;
  code?: string;
  route?: string;
};

const RETENTION_DAYS = 7;

export type OperationalErrorQuery = {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
};

function operationalErrorQuery(url: string): OperationalErrorQuery {
  const sql = neon(url);
  return {
    // Adapt Neon's richer query promise to the small, portable interface also
    // implemented by PGlite in integration tests. No cast can hide SDK drift.
    query: async (text, params = []) => sql.query(text, params),
  };
}

export function normalizeOperationalError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Stable diagnostic identity without persisting a message, stack, request id,
 * event id, email address, or any other potentially customer-derived value.
 */
export async function operationalErrorFingerprint(error: unknown): Promise<string> {
  const normalized = normalizeOperationalError(error);
  const stackShape = normalized.stack?.split("\n").slice(1, 5).join("\n") ?? "";
  // Error messages may contain emails, tokens, provider responses, or other
  // guessable customer data. Even a one-way unkeyed digest would allow an
  // offline dictionary test, so only class and message-free stack frames form
  // the durable identity. The raw message remains in access-controlled logs.
  const material = `${normalized.name}\u0000${stackShape}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function minuteBucket(now: Date): Date {
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

/** Aggregate repeated failures into one row per fingerprint/feature/code/minute. */
export async function recordOperationalErrorIn(
  queryer: OperationalErrorQuery,
  error: unknown,
  context: OperationalErrorContext,
  now: Date = new Date(),
): Promise<void> {
  const fingerprint = await operationalErrorFingerprint(error);
  const feature = context.feature.slice(0, 200);
  const code = (context.code ?? "UNKNOWN").slice(0, 100);
  const bucketStartedAt = minuteBucket(now);

  await queryer.query(
    `insert into operational_error_buckets(
       fingerprint, feature, code, bucket_started_at, first_seen_at, last_seen_at, occurrences
     ) values($1,$2,$3,$4,$5,$5,1)
     on conflict(fingerprint, feature, code, bucket_started_at) do update set
       last_seen_at = greatest(operational_error_buckets.last_seen_at, excluded.last_seen_at),
       occurrences = operational_error_buckets.occurrences + 1`,
    [fingerprint, feature, code, bucketStartedAt, now],
  );
}

export function recordOperationalError(error: unknown, context: OperationalErrorContext): Promise<void> {
  const url = getEnv().DATABASE_URL;
  if (!url) return Promise.resolve();
  return recordOperationalErrorIn(operationalErrorQuery(url), error, context);
}

export async function pruneOperationalErrorsIn(
  queryer: OperationalErrorQuery,
  now: Date = new Date(),
): Promise<{ deletedOperationalErrorBuckets: number }> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await queryer.query(
    "delete from operational_error_buckets where last_seen_at < $1 returning fingerprint",
    [cutoff],
  );
  const deleted = Array.isArray(result)
    ? result
    : typeof result === "object" && result !== null && "rows" in result && Array.isArray((result as { rows: unknown }).rows)
      ? (result as { rows: unknown[] }).rows
      : [];
  return { deletedOperationalErrorBuckets: deleted.length };
}

export function pruneOperationalErrors(now?: Date): Promise<{ deletedOperationalErrorBuckets: number }> {
  const url = getEnv().DATABASE_URL;
  if (!url) return Promise.resolve({ deletedOperationalErrorBuckets: 0 });
  return pruneOperationalErrorsIn(operationalErrorQuery(url), now);
}
