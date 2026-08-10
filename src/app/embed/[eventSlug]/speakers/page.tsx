import { notFound } from "next/navigation";
import { getEventBySlug } from "@/features/events";
import { EmbedDisabledNotice } from "@/features/public/embed-disabled-notice";
import { PublicEventShell } from "@/features/public/public-event-shell";
import { PublicSpeakersList } from "@/features/public/public-speakers-list";
import { getOrCreateSpeakerListConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSpeakers } from "@/features/public/server/public-queries";
import { parseEmbedOptions } from "../embed-options";

export default async function Page({ params, searchParams }: { params: Promise<{ eventSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) notFound();

  const embedOptions = parseEmbedOptions(await searchParams);

  // Same gate-before-fetch + config-not-URL discipline as every embed route.
  // This URL used to serve `speaker_gallery` (M33); use the migration-aware
  // getter so an event that already configured that legacy embed keeps its
  // kill switch and style instead of silently reading a fresh default row.
  const config = await getOrCreateSpeakerListConfig(event.id);
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
