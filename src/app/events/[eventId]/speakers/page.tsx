import type { Metadata } from "next";
import { SpeakersPage } from "@/features/portal/speakers-page";
import { parseSpeakerMissing } from "@/features/portal/speaker-deep-links";

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
  return (
    <SpeakersPage
      key={`${requestedContact ?? "all"}:${missing ?? "all"}`}
      eventId={eventId}
      initialContactId={requestedContact ?? null}
      missing={missing}
    />
  );
}
