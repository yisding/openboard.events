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
});
