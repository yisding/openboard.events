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
