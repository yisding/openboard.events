import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { db } from "@/db/client";
import { fileIdSchema, LIMITS, plainTextLength, type ContactId, type EventId } from "@/shared/contracts";
import { sanitize } from "@/shared/lib/sanitize";
import { updateContactFields, type ContactPatch } from "../../server/contacts";
import { getSpeakerProfileIn, type SpeakerProfileDTO } from "./queries";

/**
 * `@/shared/contracts/speaker.ts` has `contactDtoSchema` (the admin/full-row
 * shape, with `otherUrl` rather than the DB's `facebook_url`) but no
 * patch-shaped input for a partial, speaker-authored write. Defined here as
 * PROPOSED rather than promoted into the frozen contract, since this module's
 * work order does not ask for a contract change and only this module writes
 * through it.
 *
 * The bio's `.refine()` uses `plainTextLength` — the exact function the client
 * counter (`RichTextEditor`) calls — so the count that renders red and the
 * count that rejects the save can never drift (R12).
 */
export const profilePatchSchema = z.object({
  bioHtml: z.string().max(20000).optional(),
  salutation: z.string().max(50).optional(),
  honorific: z.string().max(50).optional(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().max(100).optional(),
  pronouns: z.string().max(50).optional(),
  gender: z.string().max(50).optional(),
  headshotFileId: fileIdSchema.nullable().optional(),
  linkedinUrl: z.url().max(500).nullable().optional(),
  twitterUrl: z.url().max(500).nullable().optional(),
  facebookUrl: z.url().max(500).nullable().optional(),
  websiteUrl: z.url().max(500).nullable().optional(),
}).refine(
  (patch) => patch.bioHtml === undefined || plainTextLength(patch.bioHtml) <= LIMITS.BIO,
  { message: `Keep the biography under ${LIMITS.BIO} characters`, path: ["bioHtml"] },
);

export type ProfilePatch = z.infer<typeof profilePatchSchema>;

/**
 * The only writer of these `contacts` columns from the portal side (resolution
 * #13). Every key is copied across **only when present** in the caller's patch
 * — omitted keys are left alone, so a stale write-back racing this save can
 * never revert a field this call did not touch (edge case #5).
 *
 * `sanitize()` runs here, at the write boundary, not trusted from the editor
 * (resolution #2): `bio_html` is rendered later on the public gallery and in
 * admin, both of which assume anything in the column already survived this.
 *
 * A single guarded `UPDATE ... WHERE (event_id, id) = (...)` through
 * `updateContactFields` — no `withTx`, this is not one of the eight audited
 * transactional paths. `dbOrTx` accepts the plain `neon-http` handle here and a
 * `tx` when a transactional caller (M18/M25's write-back) passes one instead.
 */
export async function updateProfileIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  patch: ProfilePatch,
): Promise<SpeakerProfileDTO> {
  const contactPatch: ContactPatch = {};
  if (patch.bioHtml !== undefined) contactPatch.bioHtml = sanitize(patch.bioHtml);
  if (patch.salutation !== undefined) contactPatch.salutation = patch.salutation;
  if (patch.honorific !== undefined) contactPatch.honorific = patch.honorific;
  if (patch.firstName !== undefined) contactPatch.firstName = patch.firstName;
  if (patch.lastName !== undefined) contactPatch.lastName = patch.lastName;
  if (patch.pronouns !== undefined) contactPatch.pronouns = patch.pronouns;
  if (patch.gender !== undefined) contactPatch.gender = patch.gender;
  if (patch.headshotFileId !== undefined) contactPatch.headshotFileId = patch.headshotFileId;
  if (patch.linkedinUrl !== undefined) contactPatch.linkedinUrl = patch.linkedinUrl;
  if (patch.twitterUrl !== undefined) contactPatch.twitterUrl = patch.twitterUrl;
  if (patch.facebookUrl !== undefined) contactPatch.facebookUrl = patch.facebookUrl;
  if (patch.websiteUrl !== undefined) contactPatch.websiteUrl = patch.websiteUrl;

  if (Object.keys(contactPatch).length > 0) {
    await updateContactFields(dbOrTx, eventId, contactId, contactPatch);
  }
  return getSpeakerProfileIn(dbOrTx, eventId, contactId);
}

export function updateProfile(eventId: EventId, contactId: ContactId, patch: ProfilePatch): Promise<SpeakerProfileDTO> {
  return updateProfileIn(db, eventId, contactId, patch);
}
