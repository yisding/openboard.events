import type { TxDb } from "@/db/client";
import { requestPortalLoginIn } from "@/features/auth";
import { updateSpeakerProfileIn } from "@/features/portal";
import type { ConfirmationStatus, ContactId, EventId } from "@/shared/contracts";

type InviteSpeakerToPortalInput = {
  eventId: EventId;
  eventSlug: string;
  contactId: ContactId;
  email: string;
  confirmationStatus: ConfirmationStatus;
  appBaseUrl: string;
  sessionSecret: string;
  fallback: boolean;
};

/**
 * The organizer invitation's credential/outbox work and its pipeline marker
 * belong to one caller-owned transaction. Keeping the composition here lets
 * the route stay the feature boundary (`auth` already imports `portal`) while
 * making the all-or-nothing behavior directly testable against PostgreSQL.
 */
export async function inviteSpeakerToPortalIn(tx: TxDb, input: InviteSpeakerToPortalInput) {
  const result = await requestPortalLoginIn(tx, {
    eventId: input.eventId,
    eventSlug: input.eventSlug,
    email: input.email,
    appBaseUrl: input.appBaseUrl,
    sessionSecret: input.sessionSecret,
    fallback: input.fallback,
  });
  if (input.confirmationStatus === "unconfirmed") {
    await updateSpeakerProfileIn(tx, input.eventId, input.contactId, { workflowStatus: "invited" });
  }
  return result;
}
