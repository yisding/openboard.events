import { z } from "zod";
import { confirmationStatusSchema } from "./enums";
import { contactIdSchema, fileIdSchema } from "./ids";

/**
 * `contacts.first_name`/`last_name` default to `''`, so a nameless contact is
 * the ordinary state for anyone created from a submission or an invitation.
 * Every public surface that renders a speaker — the gallery, the schedule, the
 * `/speaking/<token>` share card, the dashboard rosters and the public JSON API
 * — has to say the same thing about that contact, so every surface that derives
 * the name in TypeScript shares this one constant rather than re-deriving (or
 * silently skipping) it. A handful of reads coalesce to the literal string
 * inside SQL instead (the v1 schedule read, the dashboard rosters); those can't
 * import a TS constant, so they repeat `'Unnamed speaker'` verbatim and must be
 * kept in step with this value by hand.
 */
export const UNNAMED_SPEAKER = "Unnamed speaker";

export function speakerDisplayName(firstName: string | null | undefined, lastName: string | null | undefined): string {
  const name = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  return name.length > 0 ? name : UNNAMED_SPEAKER;
}

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
