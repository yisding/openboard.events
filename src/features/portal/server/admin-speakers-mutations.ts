import { z } from "zod";
import type { DbOrTx } from "@/db/client";
import { db } from "@/db/client";
import { LIMITS, plainTextLength, type ConfirmationStatus, type ContactId, type EventId, type FileId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { sanitize } from "@/shared/lib/sanitize";
import { updateContactFields } from "./contacts";

/**
 * The Speakers admin writes (M27). Both go through `updateContactFields`
 * (resolution #13) — field-scoped, never a whole-row `UPDATE contacts` — so a
 * concurrent portal profile save (M22) can never be clobbered by an organizer
 * fixing an email in another tab (analysis trap 5).
 *
 * Neither of these is one of the eight `withTx`-audited functions (PLAN
 * resolution #4): each is a single guarded `UPDATE ... WHERE (event_id, id) = (...)`
 * over the plain `neon-http` handle, not a multi-statement transaction.
 */

// Trim/lowercase first, *then* check the email format — chained the other way
// (`z.email().trim()`), the format check runs on the untrimmed, mixed-case
// input and rejects a perfectly fixable "  Ada@Example.com  ".
export const speakerEmailSchema = z.string().trim().toLowerCase().pipe(z.email());

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return true;
  const cause = error instanceof Error ? error.cause : undefined;
  const causeCode = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  if (causeCode === "23505") return true;
  const message = error instanceof Error ? error.message : "";
  const causeMessage = cause instanceof Error ? cause.message : "";
  return /duplicate key value|unique constraint/i.test(`${message} ${causeMessage}`);
}

/**
 * Normalizes to `lower(btrim(email))` (matching `updateContactFields`'s own
 * normalization) and writes only the `email` column. `contacts` has a
 * `(event_id, email)` unique constraint — a collision with another contact in
 * this event is caught and reported as a friendly field error rather than the
 * raw Postgres 23505.
 */
export async function updateSpeakerEmailIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId, email: string): Promise<void> {
  const parsed = speakerEmailSchema.safeParse(email);
  if (!parsed.success) throw new AppError("VALIDATION", "Enter a valid email address");
  try {
    await updateContactFields(dbOrTx, eventId, contactId, { email: parsed.data });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("CONFLICT", "Another speaker in this event already uses that address.", { field: "email" });
    }
    throw error;
  }
}

export function updateSpeakerEmail(eventId: EventId, contactId: ContactId, email: string): Promise<void> {
  return updateSpeakerEmailIn(db, eventId, contactId, email);
}

/**
 * The manual counterpart to `notifyDecisions`' auto-confirm (resolution #15) —
 * this module never adds a second automatic confirmation rule, only a
 * organizer-driven override for a speaker who drops out or needs a manual
 * nudge back to confirmed. Setting `declined` removes the contact from
 * `published_speakers_v` (it filters on `confirmation_status='confirmed'`),
 * so the public gallery and the dashboard donut both move on their next read.
 */
export async function setConfirmationStatusIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  status: ConfirmationStatus,
): Promise<void> {
  await updateContactFields(dbOrTx, eventId, contactId, { confirmationStatus: status });
}

export function setConfirmationStatus(eventId: EventId, contactId: ContactId, status: ConfirmationStatus): Promise<void> {
  return setConfirmationStatusIn(db, eventId, contactId, status);
}

/**
 * M52 — an organizer edits a speaker's bio or headshot from the Speakers
 * admin detail view, through the same `updateContactFields` writer the
 * speaker's own portal profile uses (resolution #13, one contacts writer).
 * `sanitize()` runs here at the write boundary, same discipline as the
 * portal's own `updateProfileIn` — bio_html is rendered on the public
 * gallery either way.
 */
export async function updateSpeakerBioIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId, bioHtml: string): Promise<void> {
  if (plainTextLength(bioHtml) > LIMITS.BIO) {
    throw new AppError("VALIDATION", `Keep the biography under ${LIMITS.BIO} characters`);
  }
  await updateContactFields(dbOrTx, eventId, contactId, { bioHtml: sanitize(bioHtml) });
}

export function updateSpeakerBio(eventId: EventId, contactId: ContactId, bioHtml: string): Promise<void> {
  return updateSpeakerBioIn(db, eventId, contactId, bioHtml);
}

/**
 * The uploaded file is only ever a fileId the organizer's own upload flow
 * returned from `finalizeUpload` (kind=headshot) — never trusted as
 * arbitrary input beyond that shape check.
 */
export async function updateSpeakerHeadshotIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId, headshotFileId: FileId | null): Promise<void> {
  await updateContactFields(dbOrTx, eventId, contactId, { headshotFileId });
}

export function updateSpeakerHeadshot(eventId: EventId, contactId: ContactId, headshotFileId: FileId | null): Promise<void> {
  return updateSpeakerHeadshotIn(db, eventId, contactId, headshotFileId);
}
