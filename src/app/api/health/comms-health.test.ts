import type { NeonQueryFunction } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { commsHealth } from "./comms-health";

/**
 * `commsHealth` is the M48 addition to `/api/health`: outbox queue depth,
 * failed-comm count, and the oldest queued row's age. It takes the same
 * tagged-template `sql` function the route already holds (no PGlite here —
 * a fake tag is enough to pin the parsing/age-computation contract without a
 * real Postgres round-trip).
 */
function fakeSql(row: Record<string, unknown> | undefined): NeonQueryFunction<false, false> {
  return (async () => (row ? [row] : [])) as unknown as NeonQueryFunction<false, false>;
}

function failingSql(message: string): NeonQueryFunction<false, false> {
  return (async () => {
    throw new Error(message);
  }) as unknown as NeonQueryFunction<false, false>;
}

describe("commsHealth", () => {
  it("reports zero counts and a null age when nothing is queued or failed", async () => {
    const result = await commsHealth(fakeSql({ queued_count: 0, failed_count: 0, oldest_queued_at: null }));
    expect(result).toEqual({ ok: true, queuedCount: 0, failedCount: 0, oldestQueuedAgeSeconds: null });
  });

  it("computes the oldest-queued age in whole seconds from the DB timestamp", async () => {
    const oldestQueuedAt = new Date(Date.now() - 90_000).toISOString();
    const result = await commsHealth(fakeSql({ queued_count: 3, failed_count: 1, oldest_queued_at: oldestQueuedAt }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.queuedCount).toBe(3);
    expect(result.failedCount).toBe(1);
    // Allow a couple of seconds of test-runtime slack either side of 90.
    expect(result.oldestQueuedAgeSeconds).toBeGreaterThanOrEqual(88);
    expect(result.oldestQueuedAgeSeconds).toBeLessThanOrEqual(93);
  });

  it("treats a clock skew that puts the row in the future as age zero, not negative", async () => {
    const oldestQueuedAt = new Date(Date.now() + 5_000).toISOString();
    const result = await commsHealth(fakeSql({ queued_count: 1, failed_count: 0, oldest_queued_at: oldestQueuedAt }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.oldestQueuedAgeSeconds).toBe(0);
  });

  it("degrades to a generic error result instead of throwing when the query fails, without putting the raw DB error on the wire", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await commsHealth(failingSql("relation \"communication_logs\" does not exist"));
    // `/api/health` has no auth guard, so anything returned here is readable
    // by anyone — the raw Postgres message must stay server-side only.
    expect(result).toEqual({ ok: false, error: "comms health check failed" });
    expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "error",
      feature: "observability",
      error: "relation \"communication_logs\" does not exist",
    });
  });

  it("defaults to zero counts and a null age when the query returns no row at all", async () => {
    const result = await commsHealth(fakeSql(undefined));
    expect(result).toEqual({ ok: true, queuedCount: 0, failedCount: 0, oldestQueuedAgeSeconds: null });
  });
});
