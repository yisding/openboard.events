import { describe, expect, it } from "vitest";
import { probeSchedule, readProbeConfig } from "../../scripts/probe-production-calendar-delivery";

describe("production calendar delivery probe", () => {
  it("requires an explicit production confirmation and normalizes recipients", () => {
    expect(readProbeConfig({
      DELIVERY_PROBE_CONFIRM: "production",
      DATABASE_URL: "postgresql://example.invalid/openboard",
      DELIVERY_PROBE_EVENT_SLUG: "ai-engineer-sandbox-event",
      DELIVERY_PROBE_RECIPIENTS: " First@Example.com,second@example.com ",
    })).toEqual({
      confirm: "production",
      databaseUrl: "postgresql://example.invalid/openboard",
      eventSlug: "ai-engineer-sandbox-event",
      recipients: ["first@example.com", "second@example.com"],
    });

    expect(() => readProbeConfig({
      DELIVERY_PROBE_CONFIRM: "preview",
      DATABASE_URL: "postgresql://example.invalid/openboard",
      DELIVERY_PROBE_EVENT_SLUG: "ai-engineer-sandbox-event",
      DELIVERY_PROBE_RECIPIENTS: "first@example.com,second@example.com",
    })).toThrow();
    expect(() => readProbeConfig({
      DELIVERY_PROBE_CONFIRM: "production",
      DATABASE_URL: "postgresql://example.invalid/openboard",
      DELIVERY_PROBE_EVENT_SLUG: "ai-engineer-sandbox-event",
      DELIVERY_PROBE_RECIPIENTS: "first@example.com,first@example.com",
    })).toThrow("two unique recipients");
  });

  it("keeps the initial and moved session inside the event bounds", () => {
    const schedule = probeSchedule(
      new Date("2026-09-15T16:00:00.000Z"),
      new Date("2026-09-15T18:00:00.000Z"),
      new Date("2026-08-15T00:00:00.000Z"),
    );
    expect(schedule).toEqual({
      initialStart: new Date("2026-09-15T16:15:00.000Z"),
      initialEnd: new Date("2026-09-15T16:45:00.000Z"),
      movedStart: new Date("2026-09-15T16:30:00.000Z"),
      movedEnd: new Date("2026-09-15T17:00:00.000Z"),
    });
    expect(() => probeSchedule(
      new Date("2026-09-15T16:00:00.000Z"),
      new Date("2026-09-15T16:59:59.000Z"),
      new Date("2026-08-15T00:00:00.000Z"),
    )).toThrow("at least 60 minutes");
    expect(() => probeSchedule(
      new Date("2026-09-15T16:00:00.000Z"),
      new Date("2026-09-15T18:00:00.000Z"),
      new Date("2026-10-01T00:00:00.000Z"),
    )).toThrow("future delivery window");
  });
});
