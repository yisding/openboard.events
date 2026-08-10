import { notFound } from "next/navigation";
import { getEventBySlug } from "@/features/events";
import { EmbedDisabledNotice } from "@/features/public/embed-disabled-notice";
import { PublicEventShell } from "@/features/public/public-event-shell";
import { PublicSpeakers } from "@/features/public/public-speakers";
import { isEmbedEnabled } from "@/features/public/server/embed-config-queries";
import { getPublishedSpeakers } from "@/features/public/server/public-queries";
import { parseEmbedOptions } from "../embed-options";

export default async function Page({ params, searchParams }: { params: Promise<{ eventSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) notFound();

  const embedOptions = parseEmbedOptions(await searchParams);

  // Same gate-before-fetch rule as the schedule embed: never call
  // `getPublishedSpeakers` while this content type is disabled.
  if (!(await isEmbedEnabled(event.id, "speaker_gallery"))) {
    return (
      <PublicEventShell active="speakers" eventSlug={eventSlug} event={{ name: event.name, timezone: event.timezone, accentColor: event.theme }} embed embedOptions={embedOptions}>
        <EmbedDisabledNotice label="speaker gallery" />
      </PublicEventShell>
    );
  }

  const speakers = await getPublishedSpeakers(eventSlug);
  if (!speakers) notFound();
  return <PublicSpeakers eventSlug={eventSlug} speakers={speakers} embed embedOptions={embedOptions} />;
}
