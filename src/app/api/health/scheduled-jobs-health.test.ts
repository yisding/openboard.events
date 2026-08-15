import type { NeonQueryFunction } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { scheduledJobsHealth } from "./scheduled-jobs-health";

function fakeSql(row: Record<string, unknown> | undefined): NeonQueryFunction<false, false> {
  return (async () => (row ? [row] : [])) as unknown as NeonQueryFunction<false, false>;
}

function failingSql(message: string): NeonQueryFunction<false, false> {
  return (async () => { throw new Error(message); }) as unknown as NeonQueryFunction<false, false>;
}

describe("scheduledJobsHealth", () => {
  const now = new Date("2026-08-11T13:00:00Z");

  it("publishes only per-job success ages", async () => {
    const result = await scheduledJobsHealth(fakeSql({
      outbox_at: "2026-08-11T12:59:30Z",
      reminders_at: "2026-08-11T12:50:00Z",
      cleanup_at: null,
      internal_result: "must-not-escape",
    }), now);
    expect(result).toEqual({
      ok: true,
      outboxLastSuccessAgeSeconds: 30,
      remindersLastSuccessAgeSeconds: 600,
      cleanupLastSuccessAgeSeconds: null,
    });
    expect(JSON.stringify(result)).not.toContain("internal_result");
  });

  it("returns null ages before the first successful ticks", async () => {
    await expect(scheduledJobsHealth(fakeSql(undefined), now)).resolves.toEqual({
      ok: true,
      outboxLastSuccessAgeSeconds: null,
      remindersLastSuccessAgeSeconds: null,
      cleanupLastSuccessAgeSeconds: null,
    });
  });

  it("keeps raw query errors server-side", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await scheduledJobsHealth(failingSql("relation scheduled_job_heartbeats is missing"), now);
    expect(result).toEqual({ ok: false, error: "scheduled jobs health check failed" });
    expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "error",
      msg: "health.scheduled_jobs_failed",
      feature: "observability",
      error: "relation scheduled_job_heartbeats is missing",
    });
  });
});
