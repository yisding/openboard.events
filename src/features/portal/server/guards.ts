import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contacts, events } from "@/db/schema";
import { requirePortal } from "@/features/auth";
import type { ContactId, EventId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";

export type PortalContext = {
  event: { id: EventId; slug: string; name: string; timezone: string };
  contact: { id: ContactId; email: string; firstName: string; lastName: string; headshotFileId: string | null };
  impersonatedByUserId: string | null;
};

/**
 * What every portal page starts with. It resolves the session, the event and the
 * contact once, so a page never has to decide who is asking.
 *
 * No session means a redirect to sign in — never a silent fall back to an admin
 * identity, which is how a portal page starts rendering somebody else's data to
 * an organizer who happens to be logged in.
 *
 * The contact is loaded by `(id, eventId)` together, so a session for one event
 * cannot resolve a contact in another even if the ids were guessed.
 */
export async function requirePortalContext(eventSlug: string): Promise<PortalContext> {
  let session;
  try {
    session = await requirePortal(eventSlug);
  } catch (error) {
    if (isAppError(error) && (error.code === "UNAUTHORIZED" || error.code === "NOT_FOUND")) {
      redirect(`/portal/${encodeURIComponent(eventSlug)}/login`);
    }
    throw error;
  }

  const [event] = await db
    .select({ id: events.id, slug: events.slug, name: events.name, timezone: events.timezone })
    .from(events)
    .where(eq(events.id, session.eventId))
    .limit(1);
  const [contact] = await db
    .select({
      id: contacts.id,
      email: contacts.email,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      headshotFileId: contacts.headshotFileId,
    })
    .from(contacts)
    .where(and(eq(contacts.id, session.contactId), eq(contacts.eventId, session.eventId)))
    .limit(1);

  // A live session whose contact or event no longer exists is a signed-out user
  // as far as the portal is concerned.
  if (!event || !contact) redirect(`/portal/${encodeURIComponent(eventSlug)}/login`);

  return {
    event: { id: event.id as EventId, slug: event.slug, name: event.name, timezone: event.timezone },
    contact: {
      id: contact.id as ContactId,
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      headshotFileId: contact.headshotFileId,
    },
    impersonatedByUserId: session.impersonatedByUserId,
  };
}
