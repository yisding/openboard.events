import { z } from "zod";
import { contactIdSchema } from "@/shared/contracts";

export const announceSpeakerLinkSchema = z.object({
  contactId: contactIdSchema,
  name: z.string(),
  shareUrl: z.url().nullable(),
});

export const announceBundleSchema = z.object({
  hasPublishedSchedule: z.boolean(),
  publicUrls: z.object({
    agenda: z.url(),
    sessions: z.url(),
    speakers: z.url(),
    gallery: z.url(),
    itinerary: z.url(),
  }),
  embedSnippet: z.string(),
  speakerLinks: z.array(announceSpeakerLinkSchema),
  announcementCopy: z.string(),
});

export type AnnounceSpeakerLink = z.infer<typeof announceSpeakerLinkSchema>;
export type AnnounceBundle = z.infer<typeof announceBundleSchema>;
