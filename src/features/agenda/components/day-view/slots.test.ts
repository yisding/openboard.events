import { describe, expect, it } from "vitest";
import { zonedInputToUtc } from "@/shared/lib/time";
import {
  clampResize,
  computeGridRange,
  gridRowCount,
  localWallTimeAt,
  minutesToGridRow,
  pixelDeltaToSlotDelta,
  SLOT_ROW_HEIGHT_PX,
} from "./slots";

const tz = "America/Los_Angeles";

describe("computeGridRange", () => {
  it("rounds an on-the-hour session down/up to its own hour", () => {
    // 2026-08-11T16:00:00Z is 9:00am PT, 2026-08-11T17:00:00Z is 10:00am PT.
    const range = computeGridRange(
      [{ startsAt: "2026-08-11T16:00:00.000Z", endsAt: "2026-08-11T17:00:00.000Z" }],
      tz,
    );
    expect(range).toEqual({ gridStartMinutes: 9 * 60, gridEndMinutes: 10 * 60 });
  });

  it("rounds an on-the-quarter-hour session out to the enclosing hour", () => {
    // 9:15am PT to 9:45am PT should widen to 9:00-10:00.
    const range = computeGridRange(
      [{ startsAt: "2026-08-11T16:15:00.000Z", endsAt: "2026-08-11T16:45:00.000Z" }],
      tz,
    );
    expect(range).toEqual({ gridStartMinutes: 9 * 60, gridEndMinutes: 10 * 60 });
  });

  it("falls back to 08:00-18:00 for an empty day", () => {
    expect(computeGridRange([], tz)).toEqual({ gridStartMinutes: 8 * 60, gridEndMinutes: 18 * 60 });
  });

  it("ignores unscheduled (null-time) rows when computing the range", () => {
    const range = computeGridRange(
      [
        { startsAt: null, endsAt: null },
        { startsAt: "2026-08-11T18:30:00.000Z", endsAt: "2026-08-11T19:00:00.000Z" }, // 11:30am-12:00pm PT
      ],
      tz,
    );
    expect(range).toEqual({ gridStartMinutes: 11 * 60, gridEndMinutes: 12 * 60 });
  });

  it("spans the widest of multiple sessions", () => {
    const range = computeGridRange(
      [
        { startsAt: "2026-08-11T16:15:00.000Z", endsAt: "2026-08-11T16:45:00.000Z" }, // 9:15-9:45am
        { startsAt: "2026-08-12T01:00:00.000Z", endsAt: "2026-08-12T01:30:00.000Z" }, // 6:00-6:30pm PT
      ],
      tz,
    );
    // The second session ends 6:30pm PT, which rounds up to a 7:00pm boundary.
    expect(range).toEqual({ gridStartMinutes: 9 * 60, gridEndMinutes: 19 * 60 });
  });
});

describe("minutesToGridRow / gridRowCount", () => {
  it("places the range start at row 1", () => {
    expect(minutesToGridRow(9 * 60, 9 * 60)).toBe(1);
  });

  it("places a quarter-hour offset at the second row", () => {
    expect(minutesToGridRow(9 * 60 + 15, 9 * 60)).toBe(2);
  });

  it("counts a 10-hour range as 40 rows of 15 minutes", () => {
    expect(gridRowCount({ gridStartMinutes: 8 * 60, gridEndMinutes: 18 * 60 })).toBe(40);
  });
});

describe("pixelDeltaToSlotDelta", () => {
  it("rounds a jiggle under half a row to zero slots", () => {
    expect(pixelDeltaToSlotDelta(SLOT_ROW_HEIGHT_PX / 2 - 1)).toBe(0);
  });

  it("rounds a full-row drag to exactly one slot", () => {
    expect(pixelDeltaToSlotDelta(SLOT_ROW_HEIGHT_PX)).toBe(1);
  });

  it("rounds a negative (upward) drag to a negative slot count", () => {
    expect(pixelDeltaToSlotDelta(-SLOT_ROW_HEIGHT_PX * 2)).toBe(-2);
  });
});

describe("clampResize", () => {
  it("never lets the start edge cross past the end minus the minimum duration", () => {
    const result = clampResize("start", 9 * 60, 9 * 60 + 30, 100); // a huge rightward drag
    expect(result.endMinutes - result.startMinutes).toBe(15);
  });

  it("never lets the end edge cross back before the start plus the minimum duration", () => {
    const result = clampResize("end", 9 * 60, 9 * 60 + 30, -100); // a huge leftward drag
    expect(result.endMinutes - result.startMinutes).toBe(15);
  });

  it("applies an ordinary one-slot drag on the start edge", () => {
    const result = clampResize("start", 9 * 60, 9 * 60 + 30, 1);
    expect(result).toEqual({ startMinutes: 9 * 60 + 15, endMinutes: 9 * 60 + 30 });
  });
});

describe("localWallTimeAt", () => {
  it("formats an in-day minute count against the given day", () => {
    expect(localWallTimeAt("2026-08-11", 9 * 60 + 15)).toBe("2026-08-11T09:15:00");
  });

  it("rolls a past-midnight end onto the next day instead of wrapping to 00:xx", () => {
    // A 60-minute session dropped in the 23:45 slot ends at 00:45 the *next* day.
    expect(localWallTimeAt("2026-08-11", 23 * 60 + 45 + 60)).toBe("2026-08-12T00:45:00");
  });

  it("rolls a negative minute count back onto the previous day", () => {
    expect(localWallTimeAt("2026-08-11", -30)).toBe("2026-08-10T23:30:00");
  });

  it("crosses a month boundary", () => {
    expect(localWallTimeAt("2026-08-31", 24 * 60)).toBe("2026-09-01T00:00:00");
    expect(localWallTimeAt("2026-09-01", -15)).toBe("2026-08-31T23:45:00");
  });

  it("produces strings zonedInputToUtc parses into an ordered instant pair", () => {
    // The regression: `T24:45:00` parsed as 00:45 of the *same* day, so the end
    // landed ~23 hours before the start; `T25:00:00` and `T-1:30:00` threw.
    const start = zonedInputToUtc(localWallTimeAt("2026-08-11", 23 * 60 + 45), tz);
    const end = zonedInputToUtc(localWallTimeAt("2026-08-11", 23 * 60 + 45 + 90), tz);
    expect(Number.isNaN(start.getTime())).toBe(false);
    expect(end.getTime() - start.getTime()).toBe(90 * 60_000);
  });
});
