import { describe, expect, it } from "vitest";
import { detectConflicts, toScheduledSession, type ScheduledSession } from "./conflicts";
import {
  contactIdSchema,
  roomIdSchema,
  scheduledSessionDtoSchema,
  sessionIdSchema,
  trackIdSchema,
  type ScheduledSessionDTO,
} from "@/shared/contracts";

const id = (suffix: string) => `d5000000-0000-4000-8000-0000000000${suffix}`;
const room = roomIdSchema.parse(id("10"));
const otherRoom = roomIdSchema.parse(id("11"));
const track = trackIdSchema.parse(id("20"));
const ada = contactIdSchema.parse(id("30"));
const grace = contactIdSchema.parse(id("31"));

const at = (hour: number, minute = 0) => Date.UTC(2026, 8, 15, hour, minute);

function session(
  overrides: Omit<Partial<ScheduledSession>, "id"> & { id: string; startsAtMs: number; endsAtMs: number },
): ScheduledSession {
  return { roomId: null, trackId: null, speakerIds: [], ...overrides, id: sessionIdSchema.parse(overrides.id) };
}

const dto = (overrides: Partial<ScheduledSessionDTO> = {}): ScheduledSessionDTO => scheduledSessionDtoSchema.parse({
  id: id("01"),
  title: "A talk",
  slug: "a-talk",
  descriptionHtml: "",
  startsAt: new Date(at(9)).toISOString(),
  endsAt: new Date(at(10)).toISOString(),
  trackId: null,
  roomId: null,
  formatId: null,
  status: "published",
  scheduleRevision: 0,
  rowVersion: 1,
  speakerIds: [],
  ...overrides,
});

describe("toScheduledSession", () => {
  it("normalizes a scheduled session to epoch milliseconds", () => {
    const normalized = toScheduledSession(dto({ roomId: room, trackId: track, speakerIds: [ada] }));
    expect(normalized).toMatchObject({ startsAtMs: at(9), endsAtMs: at(10), roomId: room, trackId: track });
    expect(normalized?.speakerIds).toEqual([ada]);
  });

  it("drops an unscheduled session rather than giving it a zero-length interval", () => {
    // This is what keeps the tray's rows structurally out of every grid.
    expect(toScheduledSession(dto({ startsAt: null, endsAt: null }))).toBeNull();
  });
});

describe("detectConflicts", () => {
  it("flags a double-booked room as an error, naming the room and the overlap", () => {
    const conflicts = detectConflicts([
      session({ id: id("01"), startsAtMs: at(9), endsAtMs: at(10), roomId: room }),
      session({ id: id("02"), startsAtMs: at(9, 30), endsAtMs: at(11), roomId: room }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "room", severity: "error", subjectId: room,
      overlapStartMs: at(9, 30), overlapEndMs: at(10),
    });
  });

  it("flags a speaker in two places, whatever room they are in", () => {
    const conflicts = detectConflicts([
      session({ id: id("01"), startsAtMs: at(9), endsAtMs: at(10), roomId: room, speakerIds: [ada, grace] }),
      session({ id: id("02"), startsAtMs: at(9, 45), endsAtMs: at(10, 30), roomId: otherRoom, speakerIds: [ada] }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "speaker", severity: "error", subjectId: ada });
  });

  it("treats an overlapping track as advice, not a blocker", () => {
    const [conflict] = detectConflicts([
      session({ id: id("01"), startsAtMs: at(9), endsAtMs: at(10), trackId: track, roomId: room }),
      session({ id: id("02"), startsAtMs: at(9), endsAtMs: at(10), trackId: track, roomId: otherRoom }),
    ]);
    expect(conflict).toMatchObject({ kind: "track", severity: "warning", subjectId: track });
  });

  it("never flags back-to-back sessions", () => {
    // The one line that must not become `<=`: an organizer whose schedule lights
    // up red for a normal 10:00/10:30 handover stops believing the feature.
    expect(detectConflicts([
      session({ id: id("01"), startsAtMs: at(10), endsAtMs: at(10, 30), roomId: room, speakerIds: [ada], trackId: track }),
      session({ id: id("02"), startsAtMs: at(10, 30), endsAtMs: at(11), roomId: room, speakerIds: [ada], trackId: track }),
    ])).toEqual([]);
  });

  it("reports one conflict per colliding subject, not one per pair of sessions", () => {
    // Same room and the same speaker is two distinct problems to fix.
    const conflicts = detectConflicts([
      session({ id: id("01"), startsAtMs: at(9), endsAtMs: at(11), roomId: room, speakerIds: [ada] }),
      session({ id: id("02"), startsAtMs: at(10), endsAtMs: at(12), roomId: room, speakerIds: [ada] }),
    ]);
    expect(conflicts.map((conflict) => conflict.kind).sort()).toEqual(["room", "speaker"]);
  });

  it("finds every pair when three sessions pile onto one room", () => {
    const conflicts = detectConflicts([
      session({ id: id("01"), startsAtMs: at(9), endsAtMs: at(12), roomId: room }),
      session({ id: id("02"), startsAtMs: at(10), endsAtMs: at(11), roomId: room }),
      session({ id: id("03"), startsAtMs: at(10, 30), endsAtMs: at(13), roomId: room }),
    ]);
    expect(conflicts).toHaveLength(3);
  });

  it("ignores a session with no room, track or speaker", () => {
    expect(detectConflicts([
      session({ id: id("01"), startsAtMs: at(9), endsAtMs: at(10) }),
      session({ id: id("02"), startsAtMs: at(9), endsAtMs: at(10) }),
    ])).toEqual([]);
  });

  it("does not care what order the sessions arrive in", () => {
    const rows = [
      session({ id: id("03"), startsAtMs: at(10, 45), endsAtMs: at(12), roomId: room }),
      session({ id: id("01"), startsAtMs: at(9), endsAtMs: at(10, 30), roomId: room }),
      session({ id: id("02"), startsAtMs: at(10), endsAtMs: at(11), roomId: room }),
      session({ id: id("05"), startsAtMs: at(9), endsAtMs: at(10), roomId: otherRoom }),
      session({ id: id("04"), startsAtMs: at(9, 30), endsAtMs: at(10, 30), roomId: otherRoom }),
    ];
    const forwards = detectConflicts(rows);
    const backwards = detectConflicts([...rows].reverse());
    expect(forwards).toHaveLength(3);
    expect(backwards).toEqual(forwards);
  });

  it("keeps a conflict identity stable when the chronological order changes", () => {
    const before = detectConflicts([
      session({ id: id("01"), startsAtMs: at(9), endsAtMs: at(11), roomId: room }),
      session({ id: id("02"), startsAtMs: at(10), endsAtMs: at(12), roomId: room }),
    ]);
    const after = detectConflicts([
      session({ id: id("01"), startsAtMs: at(10), endsAtMs: at(12), roomId: room }),
      session({ id: id("02"), startsAtMs: at(9), endsAtMs: at(11), roomId: room }),
    ]);
    expect(after).toEqual(before);
  });

  it("matches a pairwise oracle across deterministic randomized schedules", () => {
    // This is deliberately a tiny local generator rather than a dependency on
    // a property-testing package: the seed is visible in a failing test and
    // the suite remains runnable in every worker/browser environment.
    const random = (seed: number) => {
      let state = seed >>> 0;
      return () => {
        state = (state * 1_664_525 + 1_013_904_223) >>> 0;
        return state / 0x1_0000_0000;
      };
    };
    const generatedId = (index: number) => `d5000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
    const keyFor = (kind: string, subjectId: string, a: string, b: string) => `${kind}:${subjectId}:${a}:${b}`;

    for (let seed = 1; seed <= 200; seed += 1) {
      const next = random(seed);
      const sessions = Array.from({ length: 12 }, (_, index) => {
        const startsAtMs = at(8) + Math.floor(next() * 12 * 60) * 60_000;
        const endsAtMs = startsAtMs + (15 + Math.floor(next() * 150)) * 60_000;
        const roomId = next() < 0.72 ? roomIdSchema.parse(generatedId(0x100 + Math.floor(next() * 4))) : null;
        const trackId = next() < 0.62 ? trackIdSchema.parse(generatedId(0x200 + Math.floor(next() * 3))) : null;
        const speakerPool = [
          contactIdSchema.parse(generatedId(0x300)),
          contactIdSchema.parse(generatedId(0x301)),
          contactIdSchema.parse(generatedId(0x302)),
          contactIdSchema.parse(generatedId(0x303)),
        ];
        const speakerIds = speakerPool.filter(() => next() < 0.38);
        return session({ id: generatedId(0x400 + index), startsAtMs, endsAtMs, roomId, trackId, speakerIds });
      });

      const expected = new Set<string>();
      const expectedPair = (left: ScheduledSession, right: ScheduledSession, kind: "room" | "track" | "speaker", subjectId: string) => {
        if (!(left.startsAtMs < right.endsAtMs && right.startsAtMs < left.endsAtMs)) return;
        const [a, b] = left.id.localeCompare(right.id) <= 0 ? [left.id, right.id] : [right.id, left.id];
        expected.add(keyFor(kind, subjectId, a, b));
      };

      for (let leftIndex = 0; leftIndex < sessions.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < sessions.length; rightIndex += 1) {
          const left = sessions[leftIndex];
          const right = sessions[rightIndex];
          if (!left || !right) continue;
          if (left.roomId && left.roomId === right.roomId) expectedPair(left, right, "room", left.roomId);
          if (left.trackId && left.trackId === right.trackId) expectedPair(left, right, "track", left.trackId);
          for (const speakerId of left.speakerIds) {
            if (right.speakerIds.includes(speakerId)) expectedPair(left, right, "speaker", speakerId);
          }
        }
      }

      const actual = detectConflicts(sessions);
      expect(new Set(actual.map((conflict) => keyFor(conflict.kind, conflict.subjectId, conflict.a, conflict.b)))).toEqual(expected);
      expect(actual.every((conflict) => conflict.a !== conflict.b)).toBe(true);
      expect(new Set(actual.map((conflict) => `${conflict.kind}:${conflict.subjectId}:${conflict.a}:${conflict.b}`)).size).toBe(actual.length);
      expect(actual.every((conflict) => conflict.overlapStartMs < conflict.overlapEndMs)).toBe(true);
      expect(detectConflicts([...sessions].reverse())).toEqual(actual);
    }

    const disjoint = Array.from({ length: 20 }, (_, index) => session({
      id: generatedId(0x500 + index),
      startsAtMs: at(8) + index * 30 * 60_000,
      endsAtMs: at(8) + (index * 30 + 15) * 60_000,
      roomId: room,
      trackId: track,
      speakerIds: [ada],
    }));
    expect(detectConflicts(disjoint)).toEqual([]);
  });
});
