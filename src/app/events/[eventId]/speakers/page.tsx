import type { Metadata } from "next";
import { SpeakersPage } from "@/features/portal/speakers-page";
import { parseSpeakerMissing } from "@/features/portal/speaker-deep-links";
import { getAdminSpeaker } from "@/features/portal/server/admin-speakers";
import { FIXTURE_DASHBOARD_SPEAKERS } from "@/features/dashboard/fixtures";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { DEMO_EVENT_ID } from "@/shared/demo/seed";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

export const metadata: Metadata = { title: "Speakers" };
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ contactId?: string | string[]; missing?: string | string[] }>;
}) {
  const { eventId } = await params;
  const query = await searchParams;
  const requestedContact = Array.isArray(query.contactId) ? query.contactId[0] : query.contactId;
  const requestedMissing = Array.isArray(query.missing) ? query.missing[0] : query.missing;
  const missing = parseSpeakerMissing(requestedMissing);
  let initialSpeaker = null;
  if (requestedContact) {
    if (isCredentialFreeLocalDemo() && eventId === DEMO_EVENT_ID) {
      initialSpeaker = FIXTURE_DASHBOARD_SPEAKERS.find((speaker) => speaker.id === requestedContact) ?? null;
    } else {
      const parsedEventId = eventIdSchema.safeParse(eventId);
      const parsedContactId = contactIdSchema.safeParse(requestedContact);
      if (parsedEventId.success && parsedContactId.success) {
        initialSpeaker = await getAdminSpeaker(parsedEventId.data, parsedContactId.data);
      }
    }
  }
  return (
    <SpeakersPage
      key={`${requestedContact ?? "all"}:${missing ?? "all"}`}
      eventId={eventId}
      initialContactId={requestedContact ?? null}
      initialSpeaker={initialSpeaker}
      missing={missing}
    />
  );
}
