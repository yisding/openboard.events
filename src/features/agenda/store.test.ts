import { describe, expect, it } from "vitest";
import { roomIdSchema, scheduledSessionDtoSchema, type ScheduledSessionDTO } from "@/shared/contracts";
import { createSessionDefaultDay, defaultScheduledRange, eventDayKeys, scheduledNeedingRoom } from "./store";

const event = {
  timezone: "America/Los_Angeles",
  startsAt: "2026-09-15T16:00:00.000Z",
  endsAt: "2026-09-17T01:00:00.000Z",
};

function session(id: string, overrides: Partial<ScheduledSessionDTO> = {}): ScheduledSessionDTO {
  return scheduledSessionDtoSchema.parse({
    id,
    title: "A talk",
    slug: `talk-${id.slice(-2)}`,
    descriptionHtml: "",
    startsAt: "2026-09-15T17:00:00.000Z",
    endsAt: "2026-09-15T17:30:00.000Z",
    trackId: null,
    roomId: null,
    formatId: null,
    status: "draft",
    scheduleRevision: 0,
    rowVersion: 1,
    speakerIds: [],
    ...overrides,
  });
}

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

  it("does not propose the previous day when the selected day has no midnight", () => {
    // The same hazard f659e7ea fixed on the server's day bounds, still live on
    // this client-side floor: `America/Havana` jumps 00:00 to 01:00 on
    // 2026-03-08, so `zonedInputToUtc("2026-03-08T00:00:00")` resolved
    // *backwards* to 2026-03-07 23:00. When the fallback branch picked that
    // floor, the create dialog proposed a session on the day before the one the
    // organizer had selected. The first real instant of 2026-03-08 in Havana is
    // 01:00 local — 05:00Z — and the proposal must never start before it.
    expect(defaultScheduledRange({
      timezone: "America/Havana",
      startsAt: "2026-03-07T14:00:00.000Z",
      endsAt: "2026-03-08T05:20:00.000Z",
    }, "2026-03-08", 30 * 60_000)).toEqual({
      startsAt: "2026-03-08T05:00:00.000Z",
      endsAt: "2026-03-08T05:20:00.000Z",
    });
  });

  it("uses the day's first real instant when the event's opening clock is skipped on it", () => {
    // An event opening at 00:30 local has no 00:30 on a day the clock jumps
    // 00:00 to 01:00, and resolving that wall time backwards would place the
    // proposal on the previous evening. 01:00 local — 05:00Z — is the honest
    // opening for that day.
    expect(defaultScheduledRange({
      timezone: "America/Havana",
      startsAt: "2026-03-07T05:30:00.000Z",
      endsAt: "2026-03-08T16:00:00.000Z",
    }, "2026-03-08", 30 * 60_000)).toEqual({
      startsAt: "2026-03-08T05:00:00.000Z",
      endsAt: "2026-03-08T05:30:00.000Z",
    });
  });

  it("keeps every calendar day when the clock springs forward mid-event", () => {
    // Stepping the cursor by 24 hours of absolute milliseconds moves the local
    // time-of-day forward an hour across a spring-forward, so a cursor starting
    // late in the evening rolls past midnight twice and the loop skipped a whole
    // day. This is what builds the Day view's tab list — a session scheduled on
    // 2026-03-08 had no tab to appear on at all — and `dayWindowsIn` mirrors it,
    // so the planner reported every session it wanted to place there as having
    // no legal slot.
    expect(eventDayKeys("2026-03-08T04:30:00.000Z", "2026-03-09T16:00:00.000Z", "America/New_York")).toEqual([
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
    ]);
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

describe("scheduledNeedingRoom", () => {
  it("keeps null and deleted-room sessions visible while excluding placed and unscheduled rows", () => {
    const roomId = roomIdSchema.parse("d5000000-0000-4000-8000-000000000010");
    const rows = [
      session("d5000000-0000-4000-8000-000000000001"),
      session("d5000000-0000-4000-8000-000000000002", { roomId: roomIdSchema.parse("d5000000-0000-4000-8000-000000000099") }),
      session("d5000000-0000-4000-8000-000000000003", { roomId }),
      session("d5000000-0000-4000-8000-000000000004", { startsAt: null, endsAt: null }),
    ];

    expect(scheduledNeedingRoom(rows, [{ id: roomId, name: "Main stage", capacity: null, sortOrder: 0 }]).map((row) => String(row.id))).toEqual([
      "d5000000-0000-4000-8000-000000000001",
      "d5000000-0000-4000-8000-000000000002",
    ]);
  });
});
