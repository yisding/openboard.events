import { describe, expect, it } from "vitest";
import { zonedInputToUtc } from "@/shared/lib/time";
import {
  clampResize,
  computeGridRange,
  gridRowCount,
  localWallTimeAt,
  minutesFromDayStartInZone,
  wallClockDurationMinutes,
  minutesToGridRow,
  pixelDeltaToSlotDelta,
  SLOT_ROW_HEIGHT_PX,
} from "./slots";

const tz = "America/Los_Angeles";

describe("computeGridRange", () => {
  const day = "2026-08-11";

  it("rounds an on-the-hour session down/up to its own hour", () => {
    // 2026-08-11T16:00:00Z is 9:00am PT, 2026-08-11T17:00:00Z is 10:00am PT.
    const range = computeGridRange(
      [{ startsAt: "2026-08-11T16:00:00.000Z", endsAt: "2026-08-11T17:00:00.000Z" }],
      day,
      tz,
    );
    expect(range).toEqual({ gridStartMinutes: 9 * 60, gridEndMinutes: 10 * 60 });
  });

  it("rounds an on-the-quarter-hour session out to the enclosing hour", () => {
    // 9:15am PT to 9:45am PT should widen to 9:00-10:00.
    const range = computeGridRange(
      [{ startsAt: "2026-08-11T16:15:00.000Z", endsAt: "2026-08-11T16:45:00.000Z" }],
      day,
      tz,
    );
    expect(range).toEqual({ gridStartMinutes: 9 * 60, gridEndMinutes: 10 * 60 });
  });

  it("falls back to 08:00-18:00 for an empty day", () => {
    expect(computeGridRange([], day, tz)).toEqual({ gridStartMinutes: 8 * 60, gridEndMinutes: 18 * 60 });
  });

  it("ignores unscheduled (null-time) rows when computing the range", () => {
    const range = computeGridRange(
      [
        { startsAt: null, endsAt: null },
        { startsAt: "2026-08-11T18:30:00.000Z", endsAt: "2026-08-11T19:00:00.000Z" }, // 11:30am-12:00pm PT
      ],
      day,
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
      day,
      tz,
    );
    // The second session ends 6:30pm PT, which rounds up to a 7:00pm boundary.
    expect(range).toEqual({ gridStartMinutes: 9 * 60, gridEndMinutes: 19 * 60 });
  });

  it("keeps a past-midnight end above its own start instead of collapsing the grid", () => {
    // 11:00pm PT on the 11th to 12:30am PT on the 12th. Read as bare
    // minutes-since-midnight the end came back as 30, never raised `latest`,
    // and the range inverted around the 11:00pm start.
    const range = computeGridRange(
      [{ startsAt: "2026-08-12T06:00:00.000Z", endsAt: "2026-08-12T07:30:00.000Z" }],
      day,
      tz,
    );
    expect(range).toEqual({ gridStartMinutes: 23 * 60, gridEndMinutes: 24 * 60 });
    expect(range.gridEndMinutes).toBeGreaterThan(range.gridStartMinutes);
  });

  it("does not let a past-midnight end shrink the range around an earlier session", () => {
    const range = computeGridRange(
      [
        { startsAt: "2026-08-11T16:00:00.000Z", endsAt: "2026-08-11T17:00:00.000Z" }, // 9:00-10:00am PT
        { startsAt: "2026-08-12T06:00:00.000Z", endsAt: "2026-08-12T07:30:00.000Z" }, // 11:00pm-12:30am PT
      ],
      day,
      tz,
    );
    // The grid still draws exactly one day: 9:00am through midnight.
    expect(range).toEqual({ gridStartMinutes: 9 * 60, gridEndMinutes: 24 * 60 });
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

describe("minutesFromDayStartInZone", () => {
  const ny = "America/New_York";

  it("reads an in-day instant as its own wall-clock minutes", () => {
    // 2026-08-11T16:15:00Z is 9:15am PT.
    expect(minutesFromDayStartInZone("2026-08-11T16:15:00.000Z", "2026-08-11", tz)).toBe(9 * 60 + 15);
  });

  it("carries a next-day end past 1440 instead of wrapping to 00:xx", () => {
    // 23:45 PT on the 11th to 00:15 PT on the 12th.
    expect(minutesFromDayStartInZone("2026-08-12T06:45:00.000Z", "2026-08-11", tz)).toBe(23 * 60 + 45);
    expect(minutesFromDayStartInZone("2026-08-12T07:15:00.000Z", "2026-08-11", tz)).toBe(24 * 60 + 15);
  });

  it("keeps wall-clock time across a fall-back transition, not elapsed time", () => {
    // America/New_York, 2025-11-02: 00:30 EDT (04:30Z) to 02:30 EST (07:30Z) is
    // three *elapsed* hours but a two-hour span on the clock the grid draws.
    // Reading the end as start + elapsed minutes put it at 03:30.
    expect(minutesFromDayStartInZone("2025-11-02T04:30:00.000Z", "2025-11-02", ny)).toBe(30);
    expect(minutesFromDayStartInZone("2025-11-02T07:30:00.000Z", "2025-11-02", ny)).toBe(150);
  });

  it("keeps wall-clock time across a spring-forward transition too", () => {
    // 2026-03-08: 01:30 EST (06:30Z) to 03:30 EDT (07:30Z) — one elapsed hour,
    // two hours on the clock, because 02:xx does not exist that morning.
    expect(minutesFromDayStartInZone("2026-03-08T06:30:00.000Z", "2026-03-08", ny)).toBe(90);
    expect(minutesFromDayStartInZone("2026-03-08T07:30:00.000Z", "2026-03-08", ny)).toBe(210);
  });

  it("moves a DST-day end edge by exactly the slot dragged", () => {
    // The regression in full: drag the end of that 00:30-02:30 session down one
    // 15-minute row and it must save 02:45 local, not 03:45.
    const day = "2025-11-02";
    const start = minutesFromDayStartInZone("2025-11-02T04:30:00.000Z", day, ny);
    const end = minutesFromDayStartInZone("2025-11-02T07:30:00.000Z", day, ny);
    const next = clampResize("end", start, end, 1);
    expect(zonedInputToUtc(localWallTimeAt(day, next.startMinutes), ny).toISOString()).toBe("2025-11-02T04:30:00.000Z");
    expect(zonedInputToUtc(localWallTimeAt(day, next.endMinutes), ny).toISOString()).toBe("2025-11-02T07:45:00.000Z");
  });
});

describe("wallClockDurationMinutes", () => {
  const ny = "America/New_York";

  it("measures an ordinary session as the clock shows it", () => {
    expect(wallClockDurationMinutes(
      "2026-08-11T16:00:00.000Z", "2026-08-11T17:30:00.000Z", "2026-08-11", "America/Los_Angeles",
    )).toBe(90);
  });

  it("does not count the repeated hour on a fall-back day", () => {
    // 00:30 EDT (04:30Z) to 02:30 EST (07:30Z): three elapsed hours, two on the
    // clock. Dragging with the elapsed figure re-laid the session two hours long
    // wherever it landed, and mailed every speaker the wrong DTEND.
    expect(wallClockDurationMinutes(
      "2025-11-02T04:30:00.000Z", "2025-11-02T07:30:00.000Z", "2025-11-02", ny,
    )).toBe(120);
  });

  it("does not lose the skipped hour on a spring-forward day", () => {
    // 01:30 EST (06:30Z) to 03:30 EDT (07:30Z): one elapsed hour, two on the
    // clock, because 02:xx never happens that morning.
    expect(wallClockDurationMinutes(
      "2026-03-08T06:30:00.000Z", "2026-03-08T07:30:00.000Z", "2026-03-08", ny,
    )).toBe(120);
  });

  it("never returns less than one slot", () => {
    expect(wallClockDurationMinutes(
      "2026-08-11T16:00:00.000Z", "2026-08-11T16:00:00.000Z", "2026-08-11", "America/Los_Angeles",
    )).toBe(15);
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
