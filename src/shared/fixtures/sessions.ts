import { scheduledSessionDtoSchema } from "@/shared/contracts";

export const SESSION_FIXTURES = [
  scheduledSessionDtoSchema.parse({ id: "00000000-0000-4000-8000-000000000601", title: "Agents", slug: "agents", descriptionHtml: "<p>Agents</p>", startsAt: "2026-09-15T16:00:00.000Z", endsAt: "2026-09-15T16:30:00.000Z", trackId: null, roomId: null, formatId: null, status: "published", scheduleRevision: 1, rowVersion: 1, speakerIds: ["00000000-0000-4000-8000-000000000401"] }),
  scheduledSessionDtoSchema.parse({ id: "00000000-0000-4000-8000-000000000602", title: "Evals", slug: "evals", descriptionHtml: "<p>Evals</p>", startsAt: "2026-09-15T16:15:00.000Z", endsAt: "2026-09-15T16:45:00.000Z", trackId: null, roomId: null, formatId: null, status: "draft", scheduleRevision: 0, rowVersion: 1, speakerIds: ["00000000-0000-4000-8000-000000000401"] }),
];
