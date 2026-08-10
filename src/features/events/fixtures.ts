import { eventIdSchema, formatIdSchema, roomIdSchema, tagIdSchema, trackIdSchema } from "@/shared/contracts";
import type { EventDTO, RoomDTO, SessionFormatDTO, TagDTO, TrackDTO } from "@/shared/contracts";

/**
 * Fixture data for this feature's own unit tests and for any other module
 * that wants an `EventDTO`/vocabulary shape without standing up PGlite. Not
 * wired into the server queries — those hit the real tables — kept purely as
 * a stable, hand-written example of the shapes this feature returns.
 */

export const FIXTURE_EVENT_ID = eventIdSchema.parse("00000000-0000-4000-8000-0000000000e1");

export const fixtureEvent: EventDTO = {
  id: FIXTURE_EVENT_ID,
  name: "AI.Engineer Sandbox — NYC",
  slug: "ai-engineer-sandbox-event",
  eventType: "conference",
  websiteUrl: null,
  location: "New York, NY",
  physicalAddress: null,
  timezone: "America/Los_Angeles",
  startsAt: "2026-11-12T17:00:00.000Z",
  endsAt: "2026-11-14T01:00:00.000Z",
  theme: null,
  logoFileId: null,
  backgroundFileId: null,
  submissionCapPerUser: 3,
  rowVersion: 1,
};

export const fixtureTracks: TrackDTO[] = [
  { id: trackIdSchema.parse("00000000-0000-4000-8000-0000000000a1"), name: "AI Agents", color: "#6958d7", description: null, sortOrder: 0 },
  { id: trackIdSchema.parse("00000000-0000-4000-8000-0000000000a2"), name: "Platforms", color: "#2f8f5b", description: null, sortOrder: 1 },
  { id: trackIdSchema.parse("00000000-0000-4000-8000-0000000000a3"), name: "Security", color: "#b6742a", description: null, sortOrder: 2 },
  { id: trackIdSchema.parse("00000000-0000-4000-8000-0000000000a4"), name: "Community", color: "#c04b6a", description: null, sortOrder: 3 },
];

export const fixtureRooms: RoomDTO[] = [
  { id: roomIdSchema.parse("00000000-0000-4000-8000-0000000000b1"), name: "Main Stage", capacity: 800, sortOrder: 0 },
  { id: roomIdSchema.parse("00000000-0000-4000-8000-0000000000b2"), name: "Workshop A", capacity: 120, sortOrder: 1 },
  { id: roomIdSchema.parse("00000000-0000-4000-8000-0000000000b3"), name: "Workshop B", capacity: 120, sortOrder: 2 },
  { id: roomIdSchema.parse("00000000-0000-4000-8000-0000000000b4"), name: "Studio", capacity: 60, sortOrder: 3 },
  { id: roomIdSchema.parse("00000000-0000-4000-8000-0000000000b5"), name: "Atrium", capacity: 200, sortOrder: 4 },
];

export const fixtureFormats: SessionFormatDTO[] = [
  { id: formatIdSchema.parse("00000000-0000-4000-8000-0000000000c1"), name: "Keynote", defaultDurationMins: 45, sortOrder: 0 },
  { id: formatIdSchema.parse("00000000-0000-4000-8000-0000000000c2"), name: "Talk", defaultDurationMins: 30, sortOrder: 1 },
  { id: formatIdSchema.parse("00000000-0000-4000-8000-0000000000c3"), name: "Workshop", defaultDurationMins: 90, sortOrder: 2 },
  { id: formatIdSchema.parse("00000000-0000-4000-8000-0000000000c4"), name: "Panel", defaultDurationMins: 45, sortOrder: 3 },
  { id: formatIdSchema.parse("00000000-0000-4000-8000-0000000000c5"), name: "Break", defaultDurationMins: 15, sortOrder: 4 },
];

export const fixtureTags: TagDTO[] = [
  { id: tagIdSchema.parse("00000000-0000-4000-8000-0000000000d1"), name: "Evals" },
  { id: tagIdSchema.parse("00000000-0000-4000-8000-0000000000d2"), name: "Safety" },
  { id: tagIdSchema.parse("00000000-0000-4000-8000-0000000000d3"), name: "Platforms" },
  { id: tagIdSchema.parse("00000000-0000-4000-8000-0000000000d4"), name: "Open source" },
  { id: tagIdSchema.parse("00000000-0000-4000-8000-0000000000d5"), name: "Community" },
  { id: tagIdSchema.parse("00000000-0000-4000-8000-0000000000d6"), name: "Tooling" },
];

export const fixtureVocabulary = { tracks: fixtureTracks, rooms: fixtureRooms, formats: fixtureFormats, tags: fixtureTags };
