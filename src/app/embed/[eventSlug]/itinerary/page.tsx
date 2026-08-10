import { notFound } from "next/navigation";
import { getEventBySlug } from "@/features/events";
import { EmbedDisabledNotice } from "@/features/public/embed-disabled-notice";
import { PublicEventShell } from "@/features/public/public-event-shell";
import { PublicItinerary } from "@/features/public/public-itinerary";
import { getOrCreateEmbedConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSchedule } from "@/features/public/server/public-queries";
import { parseEmbedOptions } from "../embed-options";

export default async function Page({ params, searchParams }: { params: Promise<{ eventSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) notFound();

  const embedOptions = parseEmbedOptions(await searchParams);

  // Same gate-before-fetch + config-not-URL discipline as every embed route.
  // The starred itinerary itself lives in the iframe document's own
  // `localStorage`, scoped to this embed's own origin — it persists across
  // reloads of the embedded page exactly like the direct surface.
  const config = await getOrCreateEmbedConfig(event.id, "schedule_itinerary");
  if (!config.enabled) {
    return (
      <PublicEventShell active="itinerary" eventSlug={eventSlug} event={{ name: event.name, timezone: event.timezone, accentColor: event.theme }} embed embedOptions={embedOptions}>
        <EmbedDisabledNotice label="schedule itinerary" />
      </PublicEventShell>
    );
  }

  const schedule = await getPublishedSchedule(eventSlug);
  if (!schedule) notFound();
  return <PublicItinerary eventSlug={eventSlug} schedule={schedule} embed embedOptions={embedOptions} filters={config.filters} />;
}
