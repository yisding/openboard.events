import { and, eq, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { contacts } from "@/db/schema";
import type { ContactId, EventId, SpeakerWorkflowStatus } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";

export type ContactPatch = Partial<{
  email: string;
  firstName: string;
  lastName: string;
  salutation: string | null;
  honorific: string | null;
  pronouns: string | null;
  gender: string | null;
  jobTitle: string | null;
  company: string | null;
  bioHtml: string | null;
  headshotFileId: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  facebookUrl: string | null;
  websiteUrl: string | null;
  confirmationStatus: "unconfirmed" | "confirmed" | "declined";
  workflowStatus: SpeakerWorkflowStatus;
  acceptanceSeenAt: Date;
}>;

/** Normalize and upsert the one event-local identity for an email address. */
export async function getOrCreateContact(dbOrTx: DbOrTx, eventId: EventId, email: string): Promise<ContactId> {
  const normalized = email.trim().toLowerCase();
  const [inserted] = await dbOrTx.insert(contacts)
    .values({ eventId, email: normalized })
    .onConflictDoNothing({ target: [contacts.eventId, contacts.email] })
    .returning();
  if (inserted) return inserted.id as ContactId;
  const [existing] = await dbOrTx.select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.eventId, eventId), eq(contacts.email, normalized)))
    .limit(1);
  if (!existing) throw new AppError("INTERNAL", "Contact upsert did not return a row");
  return existing.id as ContactId;
}

/** Apply an event-scoped field patch without permitting whole-row replacement. */
export async function updateContactFields(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId, patch: ContactPatch): Promise<void> {
  const values = { ...patch, ...(patch.email ? { email: patch.email.trim().toLowerCase() } : {}), updatedAt: new Date() };
  const [updated] = await dbOrTx.update(contacts)
    .set(values)
    .where(and(eq(contacts.eventId, eventId), eq(contacts.id, contactId)))
    .returning();
  if (!updated) throw new AppError("NOT_FOUND", "Contact not found");
}

/**
 * Every column a `ContactPatch` can address, so a fill can read the current
 * value of each one. `satisfies` is what keeps this list honest: adding a key
 * to `ContactPatch` without adding it here stops compiling.
 */
const PATCHABLE_COLUMNS = {
  email: contacts.email,
  firstName: contacts.firstName,
  lastName: contacts.lastName,
  salutation: contacts.salutation,
  honorific: contacts.honorific,
  pronouns: contacts.pronouns,
  gender: contacts.gender,
  jobTitle: contacts.jobTitle,
  company: contacts.company,
  bioHtml: contacts.bioHtml,
  headshotFileId: contacts.headshotFileId,
  linkedinUrl: contacts.linkedinUrl,
  twitterUrl: contacts.twitterUrl,
  facebookUrl: contacts.facebookUrl,
  websiteUrl: contacts.websiteUrl,
  confirmationStatus: contacts.confirmationStatus,
  workflowStatus: contacts.workflowStatus,
  acceptanceSeenAt: contacts.acceptanceSeenAt,
} satisfies Record<keyof ContactPatch, unknown>;

/** Never had a value: NULL, or the empty string these text columns default to. */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/**
 * Write only the fields this contact has never had a value for.
 *
 * The write-through rule for someone else's contact row is "fill the gaps,
 * never overwrite". A CFP submitter who names a co-speaker is not authenticated
 * as them, so their answers must not be able to rename, re-employ or re-bio an
 * identity that already exists — but a co-speaker whose row is nothing but an
 * email address has no identity to protect, and refusing to write there is what
 * left them nameless in the abstracts list, the drawer and their own portal.
 *
 * Blankness, not a created-in-this-transaction flag, is the question worth
 * asking: the CFP wizard autosaves drafts, and `saveDraftAnswers` already
 * created the co-speaker's contact rows long before submit reaches this point.
 */
export async function fillBlankContactFields(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
  patch: ContactPatch,
): Promise<void> {
  const offered = Object.entries(patch).filter(([, value]) => !isBlank(value));
  if (offered.length === 0) return;
  const [current] = await dbOrTx.select(PATCHABLE_COLUMNS)
    .from(contacts)
    .where(and(eq(contacts.eventId, eventId), eq(contacts.id, contactId)))
    .limit(1);
  if (!current) throw new AppError("NOT_FOUND", "Contact not found");
  const gaps = Object.fromEntries(offered.filter(([key]) => isBlank(current[key as keyof typeof current]))) as ContactPatch;
  if (Object.keys(gaps).length === 0) return;
  await updateContactFields(dbOrTx, eventId, contactId, gaps);
}


/**
 * Confirm every participant of these newly accepted submissions.
 *
 * `published_speakers_v` requires `confirmation_status = 'confirmed'`, so an
 * unconfirmed participant is joined away from the public schedule, the speaker
 * gallery, the ICS feed and the embed — a session promoted from a two-speaker
 * abstract published with only its primary speaker listed, and one accepted
 * without a decision email published with an empty speaker array. Confirmation
 * belongs to the acceptance, not to the mail that announces it.
 *
 * Only `unconfirmed` is promoted. An organizer who set someone to `declined`
 * has said the opposite, and re-accepting an abstract must not quietly put
 * them back in the public gallery.
 */
/**
 * The same "only `unconfirmed` is promoted" rule, for one contact that has no
 * `submission_participants` row to reach through.
 *
 * `notifyQueues` handles the submitter-is-presenter case with a plain
 * `updateContactFields`, which is an unguarded field patch — so re-notifying an
 * accepted abstract with no primary participant silently flipped an organizer's
 * explicit `declined` back to `confirmed`, restoring that person to the public
 * gallery, schedule, ICS feed and embed. That is precisely what the rule three
 * lines above exists to prevent; the fallback simply did not go through it.
 */
export async function confirmContactIfUnconfirmedIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
): Promise<void> {
  await dbOrTx.execute(sql`
    UPDATE contacts SET confirmation_status = 'confirmed', updated_at = now()
    WHERE event_id = ${eventId} AND id = ${contactId}
      AND confirmation_status = 'unconfirmed'
  `);
}

export async function confirmSubmissionParticipantsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  submissionIds: readonly string[],
): Promise<void> {
  if (submissionIds.length === 0) return;
  await dbOrTx.execute(sql`
    UPDATE contacts c SET confirmation_status = 'confirmed', updated_at = now()
    WHERE c.event_id = ${eventId}
      AND c.confirmation_status = 'unconfirmed'
      AND EXISTS (
        SELECT 1 FROM submission_participants sp
        WHERE sp.contact_id = c.id
          AND sp.event_id = c.event_id
          AND sp.submission_id IN (${sql.join(submissionIds.map((id) => sql`${id}`), sql`, `)})
      )
  `);
}
