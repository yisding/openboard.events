import { notFound } from "next/navigation";
import { getEventBySlug } from "@/features/events";
import { EmbedDisabledNotice } from "@/features/public/embed-disabled-notice";
import { PublicEventShell } from "@/features/public/public-event-shell";
import { PublicSpeakersList } from "@/features/public/public-speakers-list";
import { getOrCreateSpeakerListConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSpeakers } from "@/features/public/server/public-queries";
import { resolveEmbedOptions } from "../embed-options";

/** See `/e/**`'s identical comment: never read `searchParams` here, or this
 * route loses the edge cache (status.md rev. 11's "known regression",
 * fixed). Style now comes from the config row fetched below. */
export const revalidate = 60;

export async function generateStaticParams(): Promise<Array<{ eventSlug: string }>> {
  return [];
}

export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) notFound();

  // Same gate-before-fetch + config-not-URL discipline as every embed route.
  // This URL used to serve `speaker_gallery` (M33); use the migration-aware
  // getter so an event that already configured that legacy embed keeps its
  // kill switch and style instead of silently reading a fresh default row.
  const config = await getOrCreateSpeakerListConfig(event.id);
  const embedOptions = resolveEmbedOptions(config.style);
  if (!config.enabled) {
    return (
      <PublicEventShell active="speakers" eventSlug={eventSlug} event={{ name: event.name, timezone: event.timezone, accentColor: event.theme }} embed embedOptions={embedOptions}>
        <EmbedDisabledNotice label="speakers list" />
      </PublicEventShell>
    );
  }

  const speakers = await getPublishedSpeakers(eventSlug);
  if (!speakers) notFound();
  return <PublicSpeakersList eventSlug={eventSlug} speakers={speakers} embed embedOptions={embedOptions} filters={config.filters} />;
}
