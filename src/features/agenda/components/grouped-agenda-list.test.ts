import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  roomIdSchema,
  scheduledSessionDtoSchema,
  trackIdSchema,
  type RoomDTO,
  type ScheduledSessionDTO,
  type TrackDTO,
} from "@/shared/contracts";
import { buildLanes, GroupedAgendaList } from "./grouped-agenda-list";

Object.assign(globalThis, { React });

const id = (suffix: string) => `d5000000-0000-4000-8000-0000000000${suffix}`;
const trackA = trackIdSchema.parse(id("20"));
const trackB = trackIdSchema.parse(id("21"));
const roomA = roomIdSchema.parse(id("10"));
const roomB = roomIdSchema.parse(id("11"));
const tz = "America/Los_Angeles";

const tracks: TrackDTO[] = [
  { id: trackA, name: "Agents", color: "#6958d7", description: null, sortOrder: 0 },
  { id: trackB, name: "Platforms", color: "#2a6486", description: null, sortOrder: 1 },
];
const rooms: RoomDTO[] = [
  { id: roomA, name: "Main Stage", capacity: 200, sortOrder: 0 },
  { id: roomB, name: "Studio", capacity: null, sortOrder: 1 },
];

function session(overrides: Omit<Partial<ScheduledSessionDTO>, "id"> & { id: string }): ScheduledSessionDTO {
  return scheduledSessionDtoSchema.parse({
    title: overrides.title ?? "A talk",
    slug: overrides.slug ?? "a-talk",
    descriptionHtml: "",
    startsAt: overrides.startsAt ?? "2026-08-11T17:00:00.000Z",
    endsAt: overrides.endsAt ?? "2026-08-11T17:30:00.000Z",
    trackId: overrides.trackId ?? null,
    roomId: overrides.roomId ?? null,
    formatId: null,
    status: "published",
    scheduleRevision: 1,
    rowVersion: 1,
    speakerIds: [],
    ...overrides,
  });
}

describe("buildLanes", () => {
  it("gives every vocabulary entry a lane, sorted by sortOrder, even with zero sessions", () => {
    const lanes = buildLanes([], "track", tracks, rooms, tz);
    expect(lanes.map((lane) => lane.key)).toEqual([trackA, trackB, "__none__"]);
    expect(lanes.every((lane) => lane.sessions.length === 0)).toBe(true);
  });

  it("buckets sessions by track and appends a trailing Uncategorized lane for null-grouped rows", () => {
    const sessions: ScheduledSessionDTO[] = [
      session({ id: id("01"), trackId: trackA }),
      session({ id: id("02"), trackId: trackB }),
      session({ id: id("03"), trackId: null }),
    ];
    const lanes = buildLanes(sessions, "track", tracks, rooms, tz);
    expect(lanes.find((lane) => lane.key === trackA)?.sessions.map((s) => s.id)).toEqual([id("01")]);
    expect(lanes.find((lane) => lane.key === trackB)?.sessions.map((s) => s.id)).toEqual([id("02")]);
    expect(lanes.find((lane) => lane.key === "__none__")?.sessions.map((s) => s.id)).toEqual([id("03")]);
  });

  it("excludes unscheduled sessions entirely — total across lanes equals the scheduled-only count", () => {
    const sessions: ScheduledSessionDTO[] = [
      session({ id: id("01"), trackId: trackA }),
      session({ id: id("02"), trackId: trackB, startsAt: null, endsAt: null }),
    ];
    const lanes = buildLanes(sessions, "track", tracks, rooms, tz);
    const total = lanes.reduce((sum, lane) => sum + lane.sessions.length, 0);
    expect(total).toBe(1);
    expect(lanes.flatMap((lane) => lane.sessions.map((s) => s.id))).not.toContain(id("02"));
  });

  it("folds a session whose group id is not in the vocabulary into the trailing lane rather than dropping it", () => {
    const danglingTrack = trackIdSchema.parse(id("99"));
    const sessions: ScheduledSessionDTO[] = [session({ id: id("01"), trackId: danglingTrack })];
    const lanes = buildLanes(sessions, "track", tracks, rooms, tz);
    expect(lanes.find((lane) => lane.key === "__none__")?.sessions.map((s) => s.id)).toEqual([id("01")]);
  });

  it("groups by room when asked, independently of the track grouping", () => {
    const sessions: ScheduledSessionDTO[] = [
      session({ id: id("01"), roomId: roomA }),
      session({ id: id("02"), roomId: roomB }),
    ];
    const lanes = buildLanes(sessions, "room", tracks, rooms, tz);
    expect(lanes.map((lane) => lane.key)).toEqual([roomA, roomB, "__none__"]);
    expect(lanes.find((lane) => lane.key === roomA)?.sessions.map((s) => s.id)).toEqual([id("01")]);
  });

  it("sorts within a lane by (eventDayKey, startsAt), never crashing on a defensively-passed null start", () => {
    const sessions: ScheduledSessionDTO[] = [
      session({ id: id("02"), trackId: trackA, startsAt: "2026-08-12T15:00:00.000Z", endsAt: "2026-08-12T15:30:00.000Z" }),
      session({ id: id("01"), trackId: trackA, startsAt: "2026-08-11T15:00:00.000Z", endsAt: "2026-08-11T15:30:00.000Z" }),
    ];
    const lanes = buildLanes(sessions, "track", tracks, rooms, tz);
    expect(lanes.find((lane) => lane.key === trackA)?.sessions.map((s) => s.id)).toEqual([id("01"), id("02")]);
  });
});

describe("<GroupedAgendaList>", () => {
  it("renders a designed empty note for a track with no sessions rather than a blank gap", () => {
    const html = renderToStaticMarkup(
      React.createElement(GroupedAgendaList, { sessions: [], groupBy: "track", tracks, rooms, tz }),
    );
    expect(html).toContain("Nothing scheduled");
    expect(html).toContain("Agents");
    expect(html).toContain("Platforms");
    expect(html).toContain("Uncategorized");
  });

  it("labels the trailing room lane Unassigned and renders a room's capacity via <Dash>", () => {
    const html = renderToStaticMarkup(
      React.createElement(GroupedAgendaList, {
        sessions: [session({ id: id("01"), roomId: roomB })],
        groupBy: "room",
        tracks,
        rooms,
        tz,
      }),
    );
    expect(html).toContain("Unassigned");
    expect(html).toContain("Main Stage");
    expect(html).toContain("200 seats");
  });
});
