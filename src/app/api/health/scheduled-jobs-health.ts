import type { NeonQueryFunction } from "@neondatabase/serverless";
import { errorMessage, log } from "@/shared/lib/log";

export type ScheduledJobsHealth = {
  ok: true;
  outboxLastSuccessAgeSeconds: number | null;
  remindersLastSuccessAgeSeconds: number | null;
  cleanupLastSuccessAgeSeconds: number | null;
} | {
  ok: false;
  error: string;
};

function ageSeconds(value: unknown, now: Date): number | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((now.getTime() - timestamp) / 1000));
}

/** Aggregate-only Cron liveness signal; no tenant or job-result data is public. */
export async function scheduledJobsHealth(
  sql: NeonQueryFunction<false, false>,
  now: Date = new Date(),
): Promise<ScheduledJobsHealth> {
  try {
    const rows = await sql`
      select
        max(last_succeeded_at) filter (where job_name = 'outbox') as outbox_at,
        max(last_succeeded_at) filter (where job_name = 'reminders') as reminders_at,
        max(last_succeeded_at) filter (where job_name = 'cleanup') as cleanup_at
      from scheduled_job_heartbeats
    `;
    const row = rows[0] as Record<string, unknown> | undefined;
    return {
      ok: true,
      outboxLastSuccessAgeSeconds: ageSeconds(row?.outbox_at, now),
      remindersLastSuccessAgeSeconds: ageSeconds(row?.reminders_at, now),
      cleanupLastSuccessAgeSeconds: ageSeconds(row?.cleanup_at, now),
    };
  } catch (error) {
    log({ level: "error", msg: "health.scheduled_jobs_failed", requestId: "health", feature: "observability", error: errorMessage(error) });
    return { ok: false, error: "scheduled jobs health check failed" };
  }
}
