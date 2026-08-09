import { z } from "zod";
import { confirmationStatusSchema } from "./enums";
import { contactIdSchema, fileIdSchema } from "./ids";

export const contactDtoSchema = z.object({
  id: contactIdSchema,
  email: z.email(),
  firstName: z.string(),
  lastName: z.string(),
  salutation: z.string().nullable(),
  honorific: z.string().nullable(),
  pronouns: z.string().nullable(),
  gender: z.string().nullable(),
  jobTitle: z.string().nullable(),
  company: z.string().nullable(),
  bioHtml: z.string().nullable(),
  headshotFileId: fileIdSchema.nullable(),
  linkedinUrl: z.url().nullable(),
  twitterUrl: z.url().nullable(),
  websiteUrl: z.url().nullable(),
  otherUrl: z.url().nullable(),
  confirmationStatus: confirmationStatusSchema,
  unsubscribedAt: z.iso.datetime().nullable(),
});
export type ContactDTO = z.infer<typeof contactDtoSchema>;
