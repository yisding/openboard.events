import { describe, expect, it } from "vitest";
import { defaultScheduledRange } from "./store";

const event = {
  timezone: "America/Los_Angeles",
  startsAt: "2026-09-15T16:00:00.000Z",
  endsAt: "2026-09-17T01:00:00.000Z",
};

describe("defaultScheduledRange", () => {
  it("uses the selected event-local day at the event's local start time", () => {
    expect(defaultScheduledRange(event, "2026-09-16", 30 * 60_000)).toEqual({
      startsAt: "2026-09-16T16:00:00.000Z",
      endsAt: "2026-09-16T16:30:00.000Z",
    });
  });

  it("falls back to the event start and clamps the duration inside a short event", () => {
    expect(defaultScheduledRange({
      timezone: "Pacific/Auckland",
      startsAt: "2026-10-03T20:00:00.000Z",
      endsAt: "2026-10-03T20:20:00.000Z",
    }, null, 30 * 60_000)).toEqual({
      startsAt: "2026-10-03T20:00:00.000Z",
      endsAt: "2026-10-03T20:20:00.000Z",
    });
  });
});
