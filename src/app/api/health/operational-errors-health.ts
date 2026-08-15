import type { NeonQueryFunction } from "@neondatabase/serverless";
import { errorMessage, log } from "@/shared/lib/log";

export const OPERATIONAL_ERROR_WINDOW_SECONDS = 60 * 60;

export type OperationalErrorsHealth = {
  ok: true;
  windowSeconds: number;
  recentCount: number;
  latestAgeSeconds: number | null;
} | {
  ok: false;
  error: string;
};

/**
 * Public, aggregate-only signal for the scheduled uptime check. Error text,
 * stack traces, fingerprints, routes, and tenant identifiers stay server-side.
 */
export async function operationalErrorsHealth(
  sql: NeonQueryFunction<false, false>,
  now: Date = new Date(),
): Promise<OperationalErrorsHealth> {
  try {
    const cutoff = new Date(now.getTime() - OPERATIONAL_ERROR_WINDOW_SECONDS * 1000);
    const rows = await sql`
      select
        coalesce(sum(occurrences) filter (where last_seen_at >= ${cutoff}), 0)::int as recent_count,
        max(last_seen_at) as latest_at
      from operational_error_buckets
    `;
    const row = rows[0] as { recent_count?: number; latest_at?: string | null } | undefined;
    const latestAt = row?.latest_at ? new Date(row.latest_at) : null;
    return {
      ok: true,
      windowSeconds: OPERATIONAL_ERROR_WINDOW_SECONDS,
      recentCount: row?.recent_count ?? 0,
      latestAgeSeconds: latestAt ? Math.max(0, Math.round((now.getTime() - latestAt.getTime()) / 1000)) : null,
    };
  } catch (error) {
    log({ level: "error", msg: "health.operational_errors_failed", requestId: "health", feature: "observability", error: errorMessage(error) });
    return { ok: false, error: "operational error health check failed" };
  }
}
