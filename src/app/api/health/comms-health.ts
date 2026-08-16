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
 *
 * `authOutbox` mirrors the same three fields for `admin_auth_email_outbox`,
 * which carries password resets, email verification, and organization
 * invitations. That table was invisible here, so every admin could be locked
 * out of password recovery with the probe still reporting green — the loudest
 * possible failure with the quietest possible signal. It is nested rather than
 * split into its own top-level block because the question an operator is
 * asking is one question ("is mail moving?"), and the two answers to it should
 * not live in two places.
 */
export type OutboxHealth = {
  queuedCount: number;
  failedCount: number;
  oldestQueuedAgeSeconds: number | null;
};

export type CommsHealth =
  | (OutboxHealth & { ok: true; authOutbox: OutboxHealth })
  | { ok: false; error: string };

type OutboxCounts = { queued_count: number; failed_count: number; oldest_queued_at: string | null };

function outboxHealth(counts: OutboxCounts | undefined, now: number): OutboxHealth {
  const oldestQueuedAt = counts?.oldest_queued_at ? new Date(counts.oldest_queued_at) : null;
  return {
    queuedCount: counts?.queued_count ?? 0,
    failedCount: counts?.failed_count ?? 0,
    oldestQueuedAgeSeconds: oldestQueuedAt ? Math.max(0, Math.round((now - oldestQueuedAt.getTime()) / 1000)) : null,
  };
}

export async function commsHealth(sql: NeonQueryFunction<false, false>): Promise<CommsHealth> {
  try {
    // Both outboxes in one round trip. The probe already costs several, and
    // adding a second aggregate per poll to answer half of one question is how
    // a health check becomes the load it is meant to detect.
    const rows = await sql`
      with event_mail as (
        select
          count(*) filter (where status = 'queued')::int as queued_count,
          count(*) filter (where status = 'failed')::int as failed_count,
          min(created_at) filter (where status = 'queued') as oldest_queued_at
        from communication_logs
      ), auth_mail as (
        select
          count(*) filter (where status = 'queued')::int as queued_count,
          count(*) filter (where status = 'failed')::int as failed_count,
          min(created_at) filter (where status = 'queued') as oldest_queued_at
        from admin_auth_email_outbox
      )
      select
        event_mail.queued_count,
        event_mail.failed_count,
        event_mail.oldest_queued_at,
        auth_mail.queued_count as auth_queued_count,
        auth_mail.failed_count as auth_failed_count,
        auth_mail.oldest_queued_at as auth_oldest_queued_at
      from event_mail, auth_mail
    `;
    const row = rows[0] as (OutboxCounts & {
      auth_queued_count: number;
      auth_failed_count: number;
      auth_oldest_queued_at: string | null;
    }) | undefined;
    const now = Date.now();
    return {
      ok: true,
      ...outboxHealth(row, now),
      authOutbox: outboxHealth(row && {
        queued_count: row.auth_queued_count,
        failed_count: row.auth_failed_count,
        oldest_queued_at: row.auth_oldest_queued_at,
      }, now),
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
