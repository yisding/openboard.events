import type { NeonQueryFunction } from "@neondatabase/serverless";
import { errorMessage, log } from "@/shared/lib/log";

/**
 * M48 — deepens the health probe with outbox observability: how many
 * `communication_logs` rows are backed up (`queued`), how many gave up
 * (`failed`), and how stale the oldest queued row is. The jobs Worker's cron
 * ticks every minute and claims up to 50 rows per tick (`dispatchOutboxIn`'s
 * default budget), so under a healthy dispatcher `queuedCount` drains to
 * near-zero within a couple of ticks and `oldestQueuedAgeSeconds` stays in
 * the tens of seconds — a row legitimately mid-retry backoff can still be
 * `queued` up to 60 minutes after `created_at` (`markFailure`'s
 * `2 ** attempts` minutes, capped at 60), which is why the alerting
 * thresholds in `docs/runbooks/alerting.md` sit well above that cap rather
 * than at "any row older than a few minutes". Deliberately its own try/catch
 * at the call site in `route.ts`, separate from the version round-trip: a
 * failure here (e.g. a locked table during a migration) must not flip the
 * primary `ok`/`db.ok` fields the uptime check and post-deploy smoke already
 * key off.
 *
 * Kept out of `route.ts` on purpose: a Next.js App Router route file may only
 * export the framework's own recognized names (`GET`, `dynamic`, etc.) — an
 * extra named export there fails `next build`'s generated route typing. This
 * file exists so the query/parsing logic can still be unit-tested directly
 * (`comms-health.test.ts`) without a live Postgres connection.
 */
export async function commsHealth(sql: NeonQueryFunction<false, false>): Promise<{
  ok: true;
  queuedCount: number;
  failedCount: number;
  oldestQueuedAgeSeconds: number | null;
} | { ok: false; error: string }> {
  try {
    const rows = await sql`
      select
        count(*) filter (where status = 'queued')::int as queued_count,
        count(*) filter (where status = 'failed')::int as failed_count,
        min(created_at) filter (where status = 'queued') as oldest_queued_at
      from communication_logs
    `;
    const row = rows[0] as { queued_count: number; failed_count: number; oldest_queued_at: string | null } | undefined;
    const oldestQueuedAt = row?.oldest_queued_at ? new Date(row.oldest_queued_at) : null;
    return {
      ok: true,
      queuedCount: row?.queued_count ?? 0,
      failedCount: row?.failed_count ?? 0,
      oldestQueuedAgeSeconds: oldestQueuedAt ? Math.max(0, Math.round((Date.now() - oldestQueuedAt.getTime()) / 1000)) : null,
    };
  } catch (error) {
    // The raw error (e.g. a Postgres message naming a table/column) stays
    // server-side only — `/api/health` has no auth guard, so anything put
    // on the wire here is readable by anyone, and this codebase's
    // convention (`defineHandler`'s catch block, `route.ts`'s own outer
    // catch just below this call) never puts internal error text where an
    // API consumer can read it. The probe has no request to key a real
    // requestId to, so it uses the shared `"health"` sentinel rather than
    // the `captureError` path `defineHandler` uses.
    log({ level: "error", msg: "health.comms_failed", requestId: "health", feature: "observability", error: errorMessage(error) });
    return { ok: false, error: "comms health check failed" };
  }
}
