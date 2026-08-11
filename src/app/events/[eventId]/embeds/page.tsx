import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/features/auth";
import { getEvent, listFormats, listRooms, listTracks } from "@/features/events";
import { EmbedsAdminPage } from "@/features/public/embeds-admin-page";
import { listEmbedConfigs } from "@/features/public/server/embed-config-queries";
import { eventIdSchema } from "@/shared/contracts";
import { DEMO_EVENT_SLUG } from "@/shared/demo/seed";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { PageHeader } from "@/shared/ui/ui-kit";

export const metadata: Metadata = { title: "Embeds" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId: rawEventId } = await params;
  if (isCredentialFreeLocalDemo()) {
    return (
      <>
        <PageHeader eyebrow="ENGAGE" title="Embeds" description="Put your live sessions, agenda, itinerary, and speakers on any website." />
        <div className="panel settings-section">
          <h2>Preview the public event surfaces</h2>
          <p className="long-copy">
            Saved embed configuration needs a connected database, so it is not available in the credential-free local demo.
            The public schedule and speaker gallery use the same responsive content rendered by the embeds.
          </p>
          <div className="page-actions">
            <Link className="button" href={`/e/${DEMO_EVENT_SLUG}/agenda`}>Open schedule</Link>
            <Link className="button button-secondary" href={`/e/${DEMO_EVENT_SLUG}/speakers`}>Open speakers</Link>
          </div>
        </div>
      </>
    );
  }

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
