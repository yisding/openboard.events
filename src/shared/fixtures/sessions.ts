import { publishedScheduleDtoSchema, publishedSpeakersDtoSchema, scheduledSessionDtoSchema } from "@/shared/contracts";

export const SESSION_FIXTURES = [
  scheduledSessionDtoSchema.parse({ id: "00000000-0000-4000-8000-000000000601", title: "Agents", slug: "agents", descriptionHtml: "<p>Agents</p>", startsAt: "2026-09-15T16:00:00.000Z", endsAt: "2026-09-15T16:30:00.000Z", trackId: null, roomId: null, formatId: null, status: "published", scheduleRevision: 1, rowVersion: 1, speakerIds: ["00000000-0000-4000-8000-000000000401"] }),
  scheduledSessionDtoSchema.parse({ id: "00000000-0000-4000-8000-000000000602", title: "Evals", slug: "evals", descriptionHtml: "<p>Evals</p>", startsAt: "2026-09-15T16:15:00.000Z", endsAt: "2026-09-15T16:45:00.000Z", trackId: null, roomId: null, formatId: null, status: "draft", scheduleRevision: 0, rowVersion: 1, speakerIds: ["00000000-0000-4000-8000-000000000401"] }),
];

export const PUBLISHED_SCHEDULE_FIXTURE = publishedScheduleDtoSchema.parse({
  event: {
    name: "OpenBoard Summit",
    timezone: "America/Los_Angeles",
    startsAt: "2026-09-15T15:00:00.000Z",
    endsAt: "2026-09-16T01:00:00.000Z",
    accentColor: "#00a878",
  },
  days: ["2026-09-15"],
  sessions: [{
    id: "00000000-0000-4000-8000-000000000601",
    slug: "agents",
    title: "Agents",
    descriptionHtml: "<p>Agents</p>",
    startsAt: "2026-09-15T16:00:00.000Z",
    endsAt: "2026-09-15T16:30:00.000Z",
    dayKey: "2026-09-15",
    track: { id: "00000000-0000-4000-8000-000000000200", name: "AI Agents", color: "#00a878" },
    room: { id: "00000000-0000-4000-8000-000000000205", name: "Main Hall" },
    format: { id: "00000000-0000-4000-8000-000000000210", name: "Talk" },
    speakers: [{
      contactId: "00000000-0000-4000-8000-000000000401",
      name: "Ada Lovelace",
      jobTitle: "Principal Engineer",
      company: "Analytical Engines",
      headshotUrl: null,
    }],
  }],
});

export const PUBLISHED_SPEAKERS_FIXTURE = publishedSpeakersDtoSchema.parse({
  event: { name: "OpenBoard Summit", timezone: "America/Los_Angeles", accentColor: "#00a878" },
  speakers: [{
    contactId: "00000000-0000-4000-8000-000000000401",
    name: "Ada Lovelace",
    jobTitle: "Principal Engineer",
    company: "Analytical Engines",
    bioHtml: "<p>Computing pioneer.</p>",
    headshotUrl: null,
    linkedinUrl: null,
    twitterUrl: null,
    websiteUrl: "https://example.com/ada",
    sessions: [{
      id: "00000000-0000-4000-8000-000000000601",
      slug: "agents",
      title: "Agents",
      startsAt: "2026-09-15T16:00:00.000Z",
      endsAt: "2026-09-15T16:30:00.000Z",
      dayKey: "2026-09-15",
      room: { id: "00000000-0000-4000-8000-000000000205", name: "Main Hall" },
      track: { id: "00000000-0000-4000-8000-000000000200", name: "AI Agents", color: "#00a878" },
      format: { id: "00000000-0000-4000-8000-000000000210", name: "Talk" },
    }],
  }],
});
