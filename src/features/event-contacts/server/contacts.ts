import { and, eq } from "drizzle-orm";
import type { DbOrTx, TxDb } from "@/db/client";
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
export async function getOrCreateContact(tx: TxDb, eventId: EventId, email: string): Promise<ContactId> {
  const normalized = email.trim().toLowerCase();
  const [inserted] = await tx.insert(contacts)
    .values({ eventId, email: normalized })
    .onConflictDoNothing({ target: [contacts.eventId, contacts.email] })
    .returning();
  if (inserted) return inserted.id as ContactId;
  const [existing] = await tx.select({ id: contacts.id })
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

