import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { contacts, events } from "@/db/schema";
import { requestPortalLoginIn } from "@/features/auth";
import { updateSpeakerProfileIn } from "@/features/portal";
import type { ContactId, EventId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { getEnv } from "@/shared/lib/env";

type InviteSpeakerToPortalInput = {
  eventId: EventId;
  contactId: ContactId;
};

/**
 * The organizer invitation's credential/outbox work and its pipeline marker
 * belong to one caller-owned transaction. Keeping the composition here lets
 * the route stay the feature boundary (`auth` already imports `portal`) while
 * making the all-or-nothing behavior directly testable against PostgreSQL.
 */
export async function inviteSpeakerToPortalIn(tx: TxDb, input: InviteSpeakerToPortalInput) {
  // A rename updates this same row. Holding the lock through credential
  // sealing makes the link's slug authoritative for the entire invite commit:
  // an earlier rename is observed, while a concurrent one waits its turn.
  const [event] = await tx.select({ slug: events.slug }).from(events)
    .where(eq(events.id, input.eventId))
    .limit(1)
    .for("update");
  if (!event) throw new AppError("NOT_FOUND", "Event not found");

  // Resolve recipient state inside the same snapshot as well. The contact
  // lock serializes an organizer edit with the login helper's own lock below.
  const [speaker] = await tx.select({
    email: contacts.email,
    confirmationStatus: contacts.confirmationStatus,
  }).from(contacts)
    .where(and(eq(contacts.eventId, input.eventId), eq(contacts.id, input.contactId)))
    .limit(1)
    .for("update");
  if (!speaker) throw new AppError("NOT_FOUND", "Speaker not found");

  const env = getEnv();
  if (!env.SESSION_SECRET) throw new AppError("INTERNAL", "SESSION_SECRET is required for portal authentication");
  const result = await requestPortalLoginIn(tx, {
    eventId: input.eventId,
    eventSlug: event.slug,
    email: speaker.email,
    appBaseUrl: env.APP_BASE_URL,
    sessionSecret: env.SESSION_SECRET,
    fallback: env.APP_ENV !== "production" && env.EMAIL_FALLBACK_UI === "1",
  });
  if (speaker.confirmationStatus === "unconfirmed") {
    await updateSpeakerProfileIn(tx, input.eventId, input.contactId, { workflowStatus: "invited" });
  }
  return result;
}
