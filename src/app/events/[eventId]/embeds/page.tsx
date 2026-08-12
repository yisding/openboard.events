import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/features/auth";
import { getEvent, listFormats, listRooms, listTracks } from "@/features/events";
import { EmbedsAdminPage } from "@/features/public/embeds-admin-page";
import { listEmbedConfigs } from "@/features/public/server/embed-config-queries";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Embeds" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;
  const parsedEventId = eventIdSchema.safeParse(rawEventId);
  if (!parsedEventId.success) notFound();
  const eventId = parsedEventId.data;
  await requireAdmin(eventId, "organizer");

  const event = await getEvent(eventId);
  if (!event) notFound();

  const [configs, tracks, formats, rooms] = await Promise.all([
    listEmbedConfigs(eventId),
    listTracks(eventId),
    listFormats(eventId),
    listRooms(eventId),
  ]);
  return <EmbedsAdminPage eventId={eventId} eventSlug={event.slug} initialConfigs={configs} tracks={tracks} formats={formats} rooms={rooms} />;
}
