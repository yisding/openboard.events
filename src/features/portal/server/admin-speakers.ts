import { and, eq } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { contacts } from "@/db/schema";
import type { ContactId, EventId } from "@/shared/contracts";
import type { SpeakerRecord } from "@/shared/demo/types";
import { stripHtml } from "@/features/comms/server/render";

type ContactSpeakerRow = {
  id: string;
  eventId: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string | null;
  jobTitle: string | null;
  bioHtml: string | null;
  headshotFileId: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  confirmation: SpeakerRecord["confirmation"];
};

export function contactSpeakerRecord(row: ContactSpeakerRow): SpeakerRecord {
  const firstInitial = row.firstName.trim().charAt(0);
  const lastInitial = row.lastName.trim().charAt(0);
  const completed = [row.firstName, row.lastName, row.company, row.jobTitle, row.bioHtml, row.headshotFileId]
    .filter(Boolean).length;
  return {
    id: row.id,
    eventId: row.eventId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    company: row.company ?? "",
    title: row.jobTitle ?? "",
    bio: row.bioHtml ? stripHtml(row.bioHtml) : "",
    location: "",
    website: row.websiteUrl ?? "",
    linkedin: row.linkedinUrl ?? "",
    avatar: `${firstInitial}${lastInitial}`.toUpperCase() || "?",
    avatarColor: "#6958d7",
    hasHeadshot: row.headshotFileId !== null,
    confirmation: row.confirmation,
    profileCompletion: Math.round((completed / 6) * 100),
    tags: [],
  };
}

export async function getAdminSpeakerIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  contactId: ContactId,
): Promise<SpeakerRecord | null> {
  const [row] = await dbOrTx.select({
    id: contacts.id,
    eventId: contacts.eventId,
    email: contacts.email,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
    company: contacts.company,
    jobTitle: contacts.jobTitle,
    bioHtml: contacts.bioHtml,
    headshotFileId: contacts.headshotFileId,
    linkedinUrl: contacts.linkedinUrl,
    websiteUrl: contacts.websiteUrl,
    confirmation: contacts.confirmationStatus,
  }).from(contacts).where(and(eq(contacts.eventId, eventId), eq(contacts.id, contactId))).limit(1);
  return row ? contactSpeakerRecord(row) : null;
}

export function getAdminSpeaker(eventId: EventId, contactId: ContactId): Promise<SpeakerRecord | null> {
  return getAdminSpeakerIn(db, eventId, contactId);
}
