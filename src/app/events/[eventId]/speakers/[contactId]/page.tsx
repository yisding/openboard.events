import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { requireAdmin } from "@/features/auth";
import { getSpeakerDetail } from "@/features/portal";
import { SpeakerDetailView } from "@/features/portal/components/speakers-admin/speaker-detail-view";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";

export const metadata: Metadata = { title: "Speaker" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string; contactId: string }> }) {
  const { eventId: rawEventId, contactId: rawContactId } = await params;

  // The credential-free demo has no database to read; its speaker view is
  // still the drawer on the list page.
  if (isCredentialFreeLocalDemo()) redirect(`/events/${rawEventId}/speakers?contactId=${encodeURIComponent(rawContactId)}`);

  const eventId = eventIdSchema.parse(rawEventId);
  const parsedContactId = contactIdSchema.safeParse(rawContactId);
  // A malformed id can never resolve to a row — same outcome as a contact id
  // scoped to another event (R4: 404, never another event's row).
  if (!parsedContactId.success) notFound();
  const contactId = parsedContactId.data;

  await requireAdmin(eventId);

  const [[event], detail] = await Promise.all([
    db.select({ timezone: events.timezone }).from(events).where(eq(events.id, eventId)).limit(1),
    getSpeakerDetail(eventId, contactId),
  ]);
  if (!detail) notFound();

  return <SpeakerDetailView eventId={eventId} timezone={event?.timezone ?? "America/Los_Angeles"} initialDetail={detail} />;
}
