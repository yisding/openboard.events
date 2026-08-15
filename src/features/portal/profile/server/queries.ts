import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { contacts } from "@/db/schema";
import type { ContactId, EventId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";

/**
 * The speaker's own editable profile. Every optional column is nullable rather
 * than defaulted to a placeholder string — a freshly-admitted speaker with
 * nothing filled in yet is a seeded state (the "missing bio/headshot" filter),
 * and the page has to render sensible placeholders for it, not synthesize text
 * that was never saved (R10).
 *
 * `headshotUrl` is resolved here, once, so every consumer (this page, the Home
 * widget summary) agrees on the address without re-deriving `/f/{id}` itself —
 * `headshot` is a public file kind (M07), so no presigned GET is needed to view
 * it.
 */
export type SpeakerProfileDTO = {
  contactId: string;
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
  headshotUrl: string | null;
  linkedinUrl: string | null;
  twitterUrl: string | null;
  facebookUrl: string | null;
  websiteUrl: string | null;
};

type ContactRow = {
  id: string;
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
};

function toDto(row: ContactRow): SpeakerProfileDTO {
  return {
    contactId: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    salutation: row.salutation,
    honorific: row.honorific,
    pronouns: row.pronouns,
    gender: row.gender,
    jobTitle: row.jobTitle,
    company: row.company,
    bioHtml: row.bioHtml,
    headshotFileId: row.headshotFileId,
    headshotUrl: row.headshotFileId ? `/f/${row.headshotFileId}` : null,
    linkedinUrl: row.linkedinUrl,
    twitterUrl: row.twitterUrl,
    facebookUrl: row.facebookUrl,
    websiteUrl: row.websiteUrl,
  };
}

/** Scoped `(id, eventId)` together, same as every other portal read (M21's rule). */
export async function getSpeakerProfileIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<SpeakerProfileDTO> {
  const [row] = await dbOrTx
    .select({
      id: contacts.id,
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
    })
    .from(contacts)
    .where(and(eq(contacts.eventId, eventId), eq(contacts.id, contactId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Profile not found");
  return toDto(row);
}

export function getSpeakerProfile(eventId: EventId, contactId: ContactId): Promise<SpeakerProfileDTO> {
  return getSpeakerProfileIn(db, eventId, contactId);
}
