import { describe, expect, it } from "vitest";
import { createSessionDefaultDay, defaultScheduledRange, eventDayKeys } from "./store";

const event = {
  timezone: "America/Los_Angeles",
  startsAt: "2026-09-15T16:00:00.000Z",
  endsAt: "2026-09-17T01:00:00.000Z",
};

describe("defaultScheduledRange", () => {
  it("creates on day two after the grid switches even while the URL still names day one", () => {
    const defaultDay = createSessionDefaultDay("day", "2026-09-16", "2026-09-15");
    expect(defaultDay).toBe("2026-09-16");
    expect(defaultScheduledRange(event, defaultDay, 30 * 60_000)).toEqual({
      startsAt: "2026-09-16T16:00:00.000Z",
      endsAt: "2026-09-16T16:30:00.000Z",
    });
  });

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

  it("keeps the selected start and shortens the duration on a partial final day", () => {
    expect(defaultScheduledRange({
      timezone: "America/Los_Angeles",
      startsAt: "2026-09-15T16:00:00.000Z",
      endsAt: "2026-09-16T16:10:00.000Z",
    }, "2026-09-16", 30 * 60_000)).toEqual({
      startsAt: "2026-09-16T16:00:00.000Z",
      endsAt: "2026-09-16T16:10:00.000Z",
    });
  });

  it("does not move a final-day fallback onto the preceding day", () => {
    expect(defaultScheduledRange({
      timezone: "America/Los_Angeles",
      startsAt: "2026-09-15T16:00:00.000Z",
      endsAt: "2026-09-16T07:10:00.000Z",
    }, "2026-09-16", 30 * 60_000)).toEqual({
      startsAt: "2026-09-16T07:00:00.000Z",
      endsAt: "2026-09-16T07:10:00.000Z",
    });
  });

  it("does not expose a zero-length day when the event ends at local midnight", () => {
    const midnightEvent = {
      timezone: "America/Los_Angeles",
      startsAt: "2026-09-15T16:00:00.000Z",
      endsAt: "2026-09-17T07:00:00.000Z",
    };

    expect(eventDayKeys(midnightEvent.startsAt, midnightEvent.endsAt, midnightEvent.timezone)).toEqual([
      "2026-09-15",
      "2026-09-16",
    ]);
    expect(defaultScheduledRange(midnightEvent, "2026-09-17", 30 * 60_000)).toEqual({
      startsAt: "2026-09-15T16:00:00.000Z",
      endsAt: "2026-09-15T16:30:00.000Z",
    });
  });
});
