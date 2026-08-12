import { and, eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { contacts, events } from "@/db/schema";
import type { ContactId, EventId } from "@/shared/contracts";
import type { EventRecord, SpeakerRecord } from "../types";
import type { PortalShellData } from "../portal-context";

/**
 * The portal chrome's data, read from the database.
 *
 * The portal header/footer were written against the browser demo fixture and
 * still speak its `EventRecord`/`SpeakerRecord` shapes, so this adapts the real
 * rows into them rather than rewriting every portal surface at once. What
 * matters is that the values are the signed-in speaker's own: before this, the
 * provider looked the event up in the demo store by slug and `notFound()`ed for
 * every real event, 404ing the whole portal for a genuinely authenticated
 * speaker.
 */
export type { PortalShellData };

// The seeded avatar palette. Picked by a stable hash of the contact id so a
// speaker keeps the same colour between renders without storing one.
const AVATAR_COLORS = ["#007454", "#2672a8", "#2a8471", "#347d87", "#45816c", "#6475a2", "#8967af", "#ac5a90", "#b25c63", "#9a6d27"] as const;

export function avatarColorFor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 100_000;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

export function initialsFor(firstName: string, lastName: string, email: string): string {
  const letters = `${firstName.trim()[0] ?? ""}${lastName.trim()[0] ?? ""}`.trim();
  return (letters || email.trim().slice(0, 2) || "SP").toUpperCase();
}

export async function getPortalShellDataIn(dbOrTx: DbOrTx, eventId: EventId, contactId: ContactId): Promise<PortalShellData | null> {
  // Scoped by (id, eventId) together (R4): a contact id from another event
  // resolves to nothing here.
  const [[event], [contact], openTaskRows] = await Promise.all([
    dbOrTx.select({
      id: events.id, slug: events.slug, name: events.name, timezone: events.timezone,
      location: events.location, startsAt: events.startsAt, endsAt: events.endsAt,
    }).from(events).where(eq(events.id, eventId)).limit(1),
    dbOrTx.select({
      id: contacts.id, email: contacts.email, firstName: contacts.firstName, lastName: contacts.lastName,
      company: contacts.company, jobTitle: contacts.jobTitle, websiteUrl: contacts.websiteUrl,
      linkedinUrl: contacts.linkedinUrl, headshotFileId: contacts.headshotFileId,
      confirmationStatus: contacts.confirmationStatus,
    }).from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.eventId, eventId))).limit(1),
    dbOrTx.execute<{ open_count: number }>(sql`
      SELECT open_count FROM speaker_outstanding_v
      WHERE event_id = ${eventId} AND contact_id = ${contactId}
    `),
  ]);
  if (!event || !contact) return null;

  const shellEvent: EventRecord = {
    id: event.id,
    slug: event.slug,
    name: event.name,
    shortName: event.name,
    timezone: event.timezone,
    city: event.location ?? "",
    venue: "",
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    accent: "var(--accent)",
    logoText: event.name,
    status: "live",
  };
  const speaker: SpeakerRecord = {
    id: contact.id,
    eventId: event.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    company: contact.company ?? "",
    title: contact.jobTitle ?? "",
    bio: "",
    location: "",
    website: contact.websiteUrl ?? "",
    linkedin: contact.linkedinUrl ?? "",
    avatar: initialsFor(contact.firstName, contact.lastName, contact.email),
    avatarColor: avatarColorFor(contact.id),
    hasHeadshot: contact.headshotFileId !== null,
    confirmation: contact.confirmationStatus,
    profileCompletion: 0,
    tags: [],
  };
  return { event: shellEvent, speaker, openTaskCount: Number((openTaskRows.rows ?? [])[0]?.open_count ?? 0) };
}

export const getPortalShellData = (eventId: EventId, contactId: ContactId): Promise<PortalShellData | null> =>
  getPortalShellDataIn(db, eventId, contactId);
