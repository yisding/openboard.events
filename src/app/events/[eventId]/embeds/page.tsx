import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/features/auth";
import { getEvent } from "@/features/events";
import { EmbedsAdminPage } from "@/features/public/embeds-admin-page";
import { listEmbedConfigs } from "@/features/public/server/embed-config-queries";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Embeds" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const parsedEventId = eventIdSchema.safeParse((await params).eventId);
  if (!parsedEventId.success) notFound();
  const eventId = parsedEventId.data;
  await requireAdmin(eventId, "organizer");

  const event = await getEvent(eventId);
  if (!event) notFound();

  const configs = await listEmbedConfigs(eventId);
  return <EmbedsAdminPage eventId={eventId} eventSlug={event.slug} initialConfigs={configs} />;
}
