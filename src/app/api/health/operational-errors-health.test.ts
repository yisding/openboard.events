import type { NeonQueryFunction } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { OPERATIONAL_ERROR_WINDOW_SECONDS, operationalErrorsHealth } from "./operational-errors-health";

function fakeSql(row: Record<string, unknown> | undefined): NeonQueryFunction<false, false> {
  return (async () => (row ? [row] : [])) as unknown as NeonQueryFunction<false, false>;
}

function failingSql(message: string): NeonQueryFunction<false, false> {
  return (async () => { throw new Error(message); }) as unknown as NeonQueryFunction<false, false>;
}

describe("operationalErrorsHealth", () => {
  const now = new Date("2026-08-11T13:00:00Z");

  it("returns a one-hour aggregate without exposing diagnostic details", async () => {
    const result = await operationalErrorsHealth(fakeSql({
      recent_count: 4,
      latest_at: "2026-08-11T12:59:30Z",
      fingerprint: "must-not-escape",
    }), now);
    expect(result).toEqual({
      ok: true,
      windowSeconds: OPERATIONAL_ERROR_WINDOW_SECONDS,
      recentCount: 4,
      latestAgeSeconds: 30,
    });
    expect(JSON.stringify(result)).not.toContain("fingerprint");
  });

  it("defaults to an empty healthy aggregate", async () => {
    await expect(operationalErrorsHealth(fakeSql(undefined), now)).resolves.toEqual({
      ok: true,
      windowSeconds: OPERATIONAL_ERROR_WINDOW_SECONDS,
      recentCount: 0,
      latestAgeSeconds: null,
    });
  });

  it("fails closed with a public-safe message when the aggregate query is unavailable", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await operationalErrorsHealth(failingSql("relation operational_error_buckets is missing"), now);
    expect(result).toEqual({ ok: false, error: "operational error health check failed" });
    expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toMatchObject({
      level: "error",
      feature: "observability",
      error: "relation operational_error_buckets is missing",
    });
  });
});
