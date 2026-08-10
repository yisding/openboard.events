import { notFound } from "next/navigation";
import { getEventBySlug } from "@/features/events";
import { EmbedDisabledNotice } from "@/features/public/embed-disabled-notice";
import { PublicEventShell } from "@/features/public/public-event-shell";
import { PublicSpeakerGallery } from "@/features/public/public-speaker-gallery";
import { getOrCreateEmbedConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSpeakers } from "@/features/public/server/public-queries";
import { parseEmbedOptions } from "../embed-options";

export default async function Page({ params, searchParams }: { params: Promise<{ eventSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) notFound();

  const embedOptions = parseEmbedOptions(await searchParams);

  // Same gate-before-fetch + config-not-URL discipline as every embed route.
  const config = await getOrCreateEmbedConfig(event.id, "speaker_gallery");
  if (!config.enabled) {
    return (
      <PublicEventShell active="gallery" eventSlug={eventSlug} event={{ name: event.name, timezone: event.timezone, accentColor: event.theme }} embed embedOptions={embedOptions}>
        <EmbedDisabledNotice label="speaker gallery" />
      </PublicEventShell>
    );
  }

  const speakers = await getPublishedSpeakers(eventSlug);
  if (!speakers) notFound();
  return <PublicSpeakerGallery eventSlug={eventSlug} speakers={speakers} embed embedOptions={embedOptions} filters={config.filters} />;
}
