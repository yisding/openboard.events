import { z } from "zod";
import { sessionStatusSchema } from "./enums";
import { contactIdSchema, formatIdSchema, roomIdSchema, sessionIdSchema, trackIdSchema } from "./ids";

export const scheduledSessionDtoSchema = z.object({
  id: sessionIdSchema,
  title: z.string(),
  slug: z.string(),
  descriptionHtml: z.string(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  trackId: trackIdSchema.nullable(),
  roomId: roomIdSchema.nullable(),
  formatId: formatIdSchema.nullable(),
  status: sessionStatusSchema,
  scheduleRevision: z.int().nonnegative(),
  rowVersion: z.int().positive(),
  speakerIds: z.array(contactIdSchema),
});
export type ScheduledSessionDTO = z.infer<typeof scheduledSessionDtoSchema>;

export const conflictDtoSchema = z.object({
  kind: z.enum(["room", "speaker", "track"]),
  severity: z.enum(["error", "warning"]),
  a: sessionIdSchema,
  b: sessionIdSchema,
  subjectId: z.string(),
  overlapStartMs: z.number(),
  overlapEndMs: z.number(),
});
export type ConflictDTO = z.infer<typeof conflictDtoSchema>;

export const mySessionDtoSchema = z.object({
  sessionId: sessionIdSchema,
  title: z.string(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  roomName: z.string().nullable(),
  trackName: z.string().nullable(),
});
export type MySessionDTO = z.infer<typeof mySessionDtoSchema>;

export const publishedSessionDtoSchema = z.object({
  id: sessionIdSchema,
  slug: z.string(),
  title: z.string(),
  descriptionHtml: z.string().nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  dayKey: z.string(),
  track: z.object({ id: trackIdSchema, name: z.string(), color: z.string() }).nullable(),
  room: z.object({ id: roomIdSchema, name: z.string() }).nullable(),
  format: z.object({ id: formatIdSchema, name: z.string() }).nullable(),
  speakers: z.array(z.object({ contactId: contactIdSchema, name: z.string(), headshotUrl: z.string().nullable() })),
});
export const publishedScheduleDtoSchema = z.object({
  event: z.object({
    name: z.string(),
    timezone: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    accentColor: z.string().nullable(),
  }),
  days: z.array(z.string()),
  sessions: z.array(publishedSessionDtoSchema),
});
export const publishedSpeakerDtoSchema = z.object({
  contactId: contactIdSchema,
  name: z.string(),
  jobTitle: z.string().nullable(),
  company: z.string().nullable(),
  bioHtml: z.string().nullable(),
  headshotUrl: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  twitterUrl: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  sessions: z.array(z.object({
    id: sessionIdSchema,
    slug: z.string(),
    title: z.string(),
    startsAt: z.iso.datetime(),
    dayKey: z.string(),
  })),
});
export const publishedSpeakersDtoSchema = z.object({
  event: z.object({ name: z.string(), timezone: z.string(), accentColor: z.string().nullable() }),
  speakers: z.array(publishedSpeakerDtoSchema),
});
export type PublishedSessionDTO = z.infer<typeof publishedSessionDtoSchema>;
export type PublishedScheduleDTO = z.infer<typeof publishedScheduleDtoSchema>;
export type PublishedSpeakerDTO = z.infer<typeof publishedSpeakerDtoSchema>;
export type PublishedSpeakersDTO = z.infer<typeof publishedSpeakersDtoSchema>;
