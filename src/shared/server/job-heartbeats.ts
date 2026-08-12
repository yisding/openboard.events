import { neon } from "@neondatabase/serverless";
import type { JobName } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";

export type JobHeartbeatQuery = {
  query: (text: string, params?: unknown[]) => Promise<unknown>;
};

function heartbeatQuery(url: string): JobHeartbeatQuery {
  const sql = neon(url);
  return {
    query: async (text, params = []) => sql.query(text, params),
  };
}

export async function recordJobSuccessIn(
  queryer: JobHeartbeatQuery,
  job: JobName,
  durationMs: number,
  succeededAt: Date = new Date(),
): Promise<void> {
  await queryer.query(
    `insert into scheduled_job_heartbeats(job_name, last_succeeded_at, last_duration_ms)
     values($1,$2,$3)
     on conflict(job_name) do update set
       last_succeeded_at = greatest(scheduled_job_heartbeats.last_succeeded_at, excluded.last_succeeded_at),
       last_duration_ms = case
         when excluded.last_succeeded_at >= scheduled_job_heartbeats.last_succeeded_at
           then excluded.last_duration_ms
         else scheduled_job_heartbeats.last_duration_ms
       end`,
    [job, succeededAt, Math.max(0, Math.min(Math.round(durationMs), 2_147_483_647))],
  );
}

/** A successful job response is not emitted until its durable heartbeat exists. */
export function recordJobSuccess(job: JobName, durationMs: number): Promise<void> {
  const url = getEnv().DATABASE_URL;
  if (!url) return Promise.resolve();
  return recordJobSuccessIn(heartbeatQuery(url), job, durationMs);
}
