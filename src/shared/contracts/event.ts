import { z } from "zod";
import { memberRoleSchema } from "./enums";
import { eventIdSchema, fileIdSchema, formatIdSchema, roomIdSchema, tagIdSchema, trackIdSchema } from "./ids";

const iso = z.iso.datetime();
export const eventDtoSchema = z.object({
  id: eventIdSchema,
  name: z.string(),
  slug: z.string(),
  eventType: z.string(),
  websiteUrl: z.url().nullable(),
  location: z.string().nullable(),
  // P3-EMAIL / CAN-SPAM: rendered in the email layout footer when set.
  physicalAddress: z.string().nullable(),
  timezone: z.string(),
  startsAt: iso,
  endsAt: iso,
  theme: z.string().nullable(),
  logoFileId: fileIdSchema.nullable(),
  backgroundFileId: fileIdSchema.nullable(),
  submissionCapPerUser: z.int().positive(),
  rowVersion: z.int().positive(),
});
export type EventDTO = z.infer<typeof eventDtoSchema>;

/** An event the current actor can actually open, plus its event-scoped role. */
export const eventAccessDtoSchema = eventDtoSchema.extend({ role: memberRoleSchema });
export type EventAccessDTO = z.infer<typeof eventAccessDtoSchema>;

export const trackDtoSchema = z.object({ id: trackIdSchema, name: z.string(), color: z.string(), description: z.string().nullable(), sortOrder: z.int() });
export const roomDtoSchema = z.object({ id: roomIdSchema, name: z.string(), capacity: z.int().nullable(), sortOrder: z.int() });
export const sessionFormatDtoSchema = z.object({ id: formatIdSchema, name: z.string(), defaultDurationMins: z.int().positive(), sortOrder: z.int() });
export const tagDtoSchema = z.object({ id: tagIdSchema, name: z.string() });
export type TrackDTO = z.infer<typeof trackDtoSchema>;
export type RoomDTO = z.infer<typeof roomDtoSchema>;
export type SessionFormatDTO = z.infer<typeof sessionFormatDtoSchema>;
export type TagDTO = z.infer<typeof tagDtoSchema>;
