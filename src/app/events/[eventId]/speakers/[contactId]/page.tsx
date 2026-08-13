import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { events } from "@/db/schema";
import { requireAdmin } from "@/features/auth";
import { getSpeakerDetail, getSpeakerRosterExtras } from "@/features/portal";
import { SpeakerDetailView } from "@/features/portal/components/speakers-admin/speaker-detail-view";
import { contactIdSchema, eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Speaker" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string; contactId: string }> }) {
  const { eventId: rawEventId, contactId: rawContactId } = await params;

  const eventId = eventIdSchema.parse(rawEventId);
  const parsedContactId = contactIdSchema.safeParse(rawContactId);
  // A malformed id can never resolve to a row — same outcome as a contact id
  // scoped to another event (R4: 404, never another event's row).
  if (!parsedContactId.success) notFound();
  const contactId = parsedContactId.data;

  // Organizer-only in its own right, not just via the layout: a soft navigation
  // renders this page without re-running the layout's guard.
  await requireAdmin(eventId, "organizer");

  const [[event], detail, extras] = await Promise.all([
    db.select({ timezone: events.timezone }).from(events).where(eq(events.id, eventId)).limit(1),
    getSpeakerDetail(eventId, contactId),
    getSpeakerRosterExtras(eventId, contactId),
  ]);
  if (!detail || !extras) notFound();

  return (
    <SpeakerDetailView
      eventId={eventId}
      timezone={event?.timezone ?? "America/Los_Angeles"}
      initialDetail={detail}
      initialExtras={extras}
    />
  );
}
