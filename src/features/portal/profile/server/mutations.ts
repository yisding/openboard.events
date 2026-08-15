import { sql } from "drizzle-orm";
import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { db } from "@/db/client";
import { fileIdSchema, LIMITS, plainTextLength, type ContactId, type EventId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { sanitize } from "@/shared/lib/sanitize";
import { buildObjectKey } from "@/shared/server/r2";
import { updateContactFields, type ContactPatch } from "@/features/event-contacts";
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
 * A `fileId` is a claim, not a credential. `fileIdSchema` only says the string
 * is a UUID, and this column is rendered on the public speaker gallery, so the
 * claim has to be checked against the caller the same way
 * `requireFinishedUpload` checks task evidence — one speaker must not be able
 * to point their profile at another's photo, or at the event's own logo, by
 * PATCHing an id lifted from a `/f/{fileId}` URL on a public page.
 *
 * Two ways in. The ordinary one is a file this contact uploaded: the portal's
 * presign stamps `uploaded_by_contact_id` for every non-admin uploader.
 * The second is the headshot they already have, which is how an organizer's
 * upload on the speaker's behalf reaches this column — that one carries
 * `uploaded_by_user_id` instead, and re-sending it is a no-op no speaker
 * should be refused.
 *
 * Ownership is not the whole question, for the same reason
 * `requireFinishedUpload` gives: `createUpload` writes the row when the presign
 * is handed out, pointing at a staging key nobody has uploaded to yet. Accepting
 * one of those sets a headshot `/f/{fileId}` answers 404 for — and pins the row
 * forever, because `ORPHAN_PREDICATE_SQL`'s first clause exempts any file a
 * contact's `headshot_file_id` references, so the daily sweep can never collect
 * it. Comparing the stored key against the published one is the same test
 * `finalizeUpload` passes on its way to writing it.
 */
async function assertOwnHeadshotIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  headshotFileId: string,
): Promise<void> {
  const result = await dbOrTx.execute<{ id: string; filename: string; r2_key: string }>(sql`
    SELECT file_assets.id, file_assets.filename, file_assets.r2_key
    FROM file_assets
    WHERE file_assets.id = ${headshotFileId}
      AND file_assets.event_id = ${eventId}
      AND file_assets.kind = 'headshot'
      AND (
        file_assets.uploaded_by_contact_id = ${contactId}
        OR EXISTS (
          SELECT 1 FROM contacts
          WHERE contacts.id = ${contactId}
            AND contacts.event_id = ${eventId}
            AND contacts.headshot_file_id = file_assets.id
        )
      )
  `);
  const asset = (result.rows ?? [])[0];
  if (!asset) {
    throw new AppError("VALIDATION", "That photo is not one of your uploads", undefined, {
      headshotFileId: "That photo is not one of your uploads",
    });
  }
  const published = buildObjectKey({ eventId, kind: "headshot", fileId: asset.id, filename: asset.filename });
  if (asset.r2_key !== published) {
    throw new AppError("VALIDATION", "That upload did not finish — send the photo again", undefined, {
      headshotFileId: "That upload did not finish — send the photo again",
    });
  }
}

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
  // Before any write: a rejected headshot must not land the rest of the patch.
  if (patch.headshotFileId) await assertOwnHeadshotIn(dbOrTx, eventId, contactId, patch.headshotFileId);

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

/**
 * M59 — the acceptance-celebration hero renders once. The portal home page
 * calls this right after it decides to show the celebration (never before —
 * a request that never rendered the celebration must not consume it), so a
 * refresh or a second tab a moment later already sees the ordinary home.
 * Same one chokepoint as every other portal-side `contacts` write.
 */
export async function markAcceptanceSeenIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<void> {
  await updateContactFields(dbOrTx, eventId, contactId, { acceptanceSeenAt: new Date() });
}

export function markAcceptanceSeen(eventId: EventId, contactId: ContactId): Promise<void> {
  return markAcceptanceSeenIn(db, eventId, contactId);
}
