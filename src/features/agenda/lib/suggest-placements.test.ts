import { describe, expect, it } from "vitest";
import type { ContactId, RoomId, SessionId, TrackId } from "@/shared/contracts";
import { isCandidateLegal, suggestPlacements, type PlannerDayWindow, type PlannerRoom, type PlannerSession, type SuggestPlacementsInput } from "./suggest-placements";

const room = (id: string, capacity: number | null = null, sortOrder = 0): PlannerRoom => ({ id: id as RoomId, capacity, sortOrder });
const sid = (value: string) => value as SessionId;
const cid = (value: string) => value as ContactId;

// 2026-09-15 is a Tuesday; the day window is 09:00–18:00 UTC for arithmetic
// simplicity — the planner never looks at a clock or a zone, so a "9am" here
// is just a round millisecond boundary, not a claim about any real time zone.
const DAY: PlannerDayWindow = {
  dayKey: "2026-09-15",
  startMs: Date.parse("2026-09-15T09:00:00Z"),
  endMsExclusive: Date.parse("2026-09-15T18:00:00Z"),
};

function session(overrides: Omit<Partial<PlannerSession>, "id"> & { id: string }): PlannerSession {
  return {
    id: sid(overrides.id),
    title: overrides.title ?? overrides.id,
    trackId: overrides.trackId ?? null,
    speakerIds: overrides.speakerIds ?? [],
    expectedAttendance: overrides.expectedAttendance ?? null,
    durationMinutes: overrides.durationMinutes ?? 30,
  };
}

function baseInput(overrides: Partial<SuggestPlacementsInput> = {}): SuggestPlacementsInput {
  return {
    days: [DAY],
    rooms: [room("room-a"), room("room-b")],
    existing: [],
    unscheduled: [],
    blackouts: [],
    ...overrides,
  };
}

describe("suggestPlacements", () => {
  it("places a single unscheduled session in the first chronological room-sort slot", () => {
    const result = suggestPlacements(baseInput({ unscheduled: [session({ id: "s1", durationMinutes: 30 })] }));
    expect(result.unplaced).toEqual([]);
    expect(result.placed).toEqual([{
      sessionId: sid("s1"), dayKey: "2026-09-15", startsAtMs: DAY.startMs, endsAtMs: DAY.startMs + 30 * 60_000, roomId: "room-a" as RoomId,
    }]);
  });

  it("is deterministic: re-running on unchanged input produces the same proposal", () => {
    const input = baseInput({
      unscheduled: [
        session({ id: "s2", durationMinutes: 45, speakerIds: [cid("ada")] }),
        session({ id: "s1", durationMinutes: 30 }),
      ],
    });
    const first = suggestPlacements(input);
    const second = suggestPlacements(input);
    expect(second).toEqual(first);
  });

  it("never proposes a slot that double-books a room already occupied by an existing session", () => {
    const existing = [{
      id: sid("holder"), startsAtMs: DAY.startMs, endsAtMs: DAY.startMs + 60 * 60_000,
      roomId: "room-a" as RoomId, trackId: null, speakerIds: [] as ContactId[],
    }];
    const result = suggestPlacements(baseInput({
      existing,
      rooms: [room("room-a")],
      unscheduled: [session({ id: "s1", durationMinutes: 30 })],
    }));
    // The only room is occupied for the first hour; the session lands after it.
    expect(result.placed).toEqual([{
      sessionId: sid("s1"), dayKey: "2026-09-15",
      startsAtMs: DAY.startMs + 60 * 60_000, endsAtMs: DAY.startMs + 90 * 60_000, roomId: "room-a" as RoomId,
    }]);
  });

  it("never proposes a slot that double-books a speaker across rooms", () => {
    const existing = [{
      id: sid("holder"), startsAtMs: DAY.startMs, endsAtMs: DAY.endMsExclusive,
      roomId: "room-b" as RoomId, trackId: null, speakerIds: [cid("ada")],
    }];
    const result = suggestPlacements(baseInput({
      existing,
      unscheduled: [session({ id: "s1", durationMinutes: 30, speakerIds: [cid("ada")] })],
    }));
    // room-a is free all day, but ada is busy all day in room-b — every
    // room-a candidate still collides on the speaker.
    expect(result.placed).toEqual([]);
    expect(result.unplaced).toEqual([{
      sessionId: sid("s1"), reason: "no_legal_slot",
      rejections: { roomOrSpeakerConflict: expect.any(Number), blackout: 0, capacity: 0 },
    }]);
    expect(result.unplaced[0]?.rejections.roomOrSpeakerConflict).toBeGreaterThan(0);
  });

  it("rejects every candidate overlapping a speaker's declared blackout, and reports it as the reason", () => {
    const result = suggestPlacements(baseInput({
      rooms: [room("room-a")],
      unscheduled: [session({ id: "s1", durationMinutes: 30, speakerIds: [cid("ada")] })],
      blackouts: [{ contactId: cid("ada"), startsAtMs: DAY.startMs, endsAtMs: DAY.endMsExclusive }],
    }));
    expect(result.placed).toEqual([]);
    expect(result.unplaced).toEqual([{
      sessionId: sid("s1"), reason: "no_legal_slot",
      rejections: { roomOrSpeakerConflict: 0, blackout: expect.any(Number), capacity: 0 },
    }]);
    expect(result.unplaced[0]?.rejections.blackout).toBeGreaterThan(0);
  });

  it("does not reject a candidate that only touches a blackout's edge (half-open)", () => {
    const result = suggestPlacements(baseInput({
      rooms: [room("room-a")],
      unscheduled: [session({ id: "s1", durationMinutes: 30, speakerIds: [cid("ada")] })],
      // The blackout ends exactly when the first candidate starts.
      blackouts: [{ contactId: cid("ada"), startsAtMs: DAY.startMs - 30 * 60_000, endsAtMs: DAY.startMs }],
    }));
    expect(result.placed).toHaveLength(1);
    expect(result.placed[0]?.startsAtMs).toBe(DAY.startMs);
  });

  it("rejects a room whose capacity is smaller than the session's expected attendance", () => {
    const result = suggestPlacements(baseInput({
      rooms: [room("small", 10)],
      unscheduled: [session({ id: "s1", durationMinutes: 30, expectedAttendance: 50 })],
    }));
    expect(result.placed).toEqual([]);
    expect(result.unplaced[0]?.rejections.capacity).toBeGreaterThan(0);
  });

  it("treats a manual session (null expected attendance) as unconstrained by any room's capacity", () => {
    const result = suggestPlacements(baseInput({
      rooms: [room("small", 1)],
      unscheduled: [session({ id: "s1", durationMinutes: 30, expectedAttendance: null })],
    }));
    expect(result.placed).toHaveLength(1);
  });

  it("treats a room with no declared capacity as unconstrained by any session's expected attendance", () => {
    const result = suggestPlacements(baseInput({
      rooms: [room("uncapped", null)],
      unscheduled: [session({ id: "s1", durationMinutes: 30, expectedAttendance: 10_000 })],
    }));
    expect(result.placed).toHaveLength(1);
  });

  it("marks a zero-or-negative duration session unplaced with invalid_duration, never searching for a slot", () => {
    const result = suggestPlacements(baseInput({ unscheduled: [session({ id: "s1", durationMinutes: 0 })] }));
    expect(result.unplaced).toEqual([{
      sessionId: sid("s1"), reason: "invalid_duration",
      rejections: { roomOrSpeakerConflict: 0, blackout: 0, capacity: 0 },
    }]);
  });

  it("never generates a candidate outside the given day window", () => {
    // A duration longer than the whole day window can never fit.
    const result = suggestPlacements(baseInput({ unscheduled: [session({ id: "s1", durationMinutes: 10 * 60 })] }));
    expect(result.placed).toEqual([]);
    expect(result.unplaced[0]?.reason).toBe("no_legal_slot");
  });

  it("sorts unscheduled sessions by fewest legal slots first, so the most constrained session is placed before it can be crowded out", () => {
    // Only one room is free after 5pm; two sessions both fit only there, but
    // "constrained" (fewer legal slots) must be scheduled first so the
    // unconstrained one still has other options if this one takes the slot.
    const existing = [{
      id: sid("holder-a"), startsAtMs: DAY.startMs, endsAtMs: DAY.startMs + 8 * 60 * 60_000,
      roomId: "room-a" as RoomId, trackId: null, speakerIds: [] as ContactId[],
    }, {
      id: sid("holder-b"), startsAtMs: DAY.startMs, endsAtMs: DAY.endMsExclusive - 90 * 60_000,
      roomId: "room-b" as RoomId, trackId: null, speakerIds: [] as ContactId[],
    }];
    const constrained = session({ id: "constrained", durationMinutes: 90, speakerIds: [cid("ada")] });
    const flexible = session({ id: "flexible", durationMinutes: 30 });
    const result = suggestPlacements(baseInput({ existing, unscheduled: [flexible, constrained] }));
    expect(result.unplaced).toEqual([]);
    expect(result.placed.find((p) => p.sessionId === sid("constrained"))?.roomId).toBe("room-b" as RoomId);
  });

  it("falls back to a single unconstrained room slot when no rooms are configured", () => {
    const result = suggestPlacements(baseInput({ rooms: [], unscheduled: [session({ id: "s1", durationMinutes: 30 })] }));
    expect(result.placed).toEqual([{ sessionId: sid("s1"), dayKey: "2026-09-15", startsAtMs: DAY.startMs, endsAtMs: DAY.startMs + 30 * 60_000, roomId: null }]);
  });

  it("breaks a tie in legal-slot count by duration descending, then by stable id", () => {
    const a = session({ id: "b-session", durationMinutes: 30 });
    const b = session({ id: "a-session", durationMinutes: 60 });
    const result = suggestPlacements(baseInput({ rooms: [room("only")], unscheduled: [a, b] }));
    // Both have identical, unconstrained legal-slot counts; the longer
    // duration (b-session, 60m) goes first regardless of array order.
    expect(result.placed.map((p) => p.sessionId)).toEqual([sid("a-session"), sid("b-session")]);
  });
});

describe("isCandidateLegal", () => {
  it("is the single legality check both the planner and the apply preflight use", () => {
    const candidate = {
      sessionId: sid("s1"), startsAtMs: DAY.startMs, endsAtMs: DAY.startMs + 30 * 60_000,
      roomId: "room-a" as RoomId, trackId: null as TrackId | null, speakerIds: [cid("ada")], expectedAttendance: null,
    };
    expect(isCandidateLegal(candidate, [], [], room("room-a"))).toEqual({ legal: true });
    expect(isCandidateLegal(candidate, [], [{ contactId: cid("ada"), startsAtMs: DAY.startMs, endsAtMs: DAY.endMsExclusive }], room("room-a")))
      .toEqual({ legal: false, reason: "blackout" });
  });
});
