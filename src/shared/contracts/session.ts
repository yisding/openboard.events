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
  title: z.string(),
  slug: z.string(),
  descriptionHtml: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  roomName: z.string().nullable(),
  trackName: z.string().nullable(),
  trackColor: z.string().nullable(),
  formatName: z.string().nullable(),
  speakers: z.array(z.object({ id: contactIdSchema, name: z.string() })),
});
export const publishedScheduleDtoSchema = z.object({
  event: z.object({ name: z.string(), slug: z.string(), timezone: z.string() }),
  sessions: z.array(publishedSessionDtoSchema),
  updatedAt: z.iso.datetime().nullable(),
});
export const publishedSpeakerDtoSchema = z.object({
  id: contactIdSchema,
  name: z.string(),
  bioHtml: z.string().nullable(),
  company: z.string().nullable(),
  jobTitle: z.string().nullable(),
  headshotUrl: z.url().nullable(),
  sessionIds: z.array(sessionIdSchema),
});
export const publishedSpeakersDtoSchema = z.object({
  event: z.object({ name: z.string(), slug: z.string() }),
  speakers: z.array(publishedSpeakerDtoSchema),
  updatedAt: z.iso.datetime().nullable(),
});
export type PublishedSessionDTO = z.infer<typeof publishedSessionDtoSchema>;
export type PublishedScheduleDTO = z.infer<typeof publishedScheduleDtoSchema>;
export type PublishedSpeakerDTO = z.infer<typeof publishedSpeakerDtoSchema>;
export type PublishedSpeakersDTO = z.infer<typeof publishedSpeakersDtoSchema>;
