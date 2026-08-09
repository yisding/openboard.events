import { describe, expect, it } from "vitest";
import { eventLocal } from "../scripts/seed/lib/helpers";
import { assertSafeSeedTarget } from "../scripts/seed/lib/safety";

describe("seed target safety", () => {
  it("refuses an unclassified target even when its opaque URL does not say production", () => {
    expect(() => assertSafeSeedTarget({
      DATABASE_URL: "postgresql://user:secret@ep-hidden-pond-123-pooler.us-west-2.aws.neon.tech/db",
    })).toThrow("unclassified database");
  });

  it("allows explicitly classified non-production targets", () => {
    expect(() => assertSafeSeedTarget({ APP_ENV: "local" })).not.toThrow();
    expect(() => assertSafeSeedTarget({ APP_ENV: "preview" })).not.toThrow();
  });

  it("requires the production capability for an explicitly production target", () => {
    expect(() => assertSafeSeedTarget({ APP_ENV: "production" })).toThrow("refusing to seed production");
    expect(() => assertSafeSeedTarget({ APP_ENV: "production", SEED_ALLOW_PROD: "1" })).not.toThrow();
  });
});

describe("eventLocal", () => {
  it("advances event-local calendar days across spring-forward", () => {
    // 23:30 Saturday in Los Angeles. Adding a 24-hour instant would land on
    // Monday locally because Sunday is only 23 hours long.
    const lateSaturday = new Date("2026-03-08T07:30:00.000Z");
    expect(eventLocal(lateSaturday, 1, "09:00").toISOString()).toBe("2026-03-08T16:00:00.000Z");
  });

  it("supports negative calendar-day offsets", () => {
    const monday = new Date("2026-03-09T19:00:00.000Z");
    expect(eventLocal(monday, -1, "09:00").toISOString()).toBe("2026-03-08T16:00:00.000Z");
  });
});
