import { notFound } from "next/navigation";
import { getEventBySlug } from "@/features/events";
import { EmbedDisabledNotice } from "@/features/public/embed-disabled-notice";
import { PublicAgenda } from "@/features/public/public-agenda";
import { PublicEventShell } from "@/features/public/public-event-shell";
import { getOrCreateEmbedConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSchedule } from "@/features/public/server/public-queries";
import { parseEmbedOptions } from "../embed-options";

export default async function Page({ params, searchParams }: { params: Promise<{ eventSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) notFound();

  const embedOptions = parseEmbedOptions(await searchParams);

  // Same gate-before-fetch + config-not-URL discipline as every embed route.
  const config = await getOrCreateEmbedConfig(event.id, "agenda");
  if (!config.enabled) {
    return (
      <PublicEventShell active="agenda" eventSlug={eventSlug} event={{ name: event.name, timezone: event.timezone, accentColor: event.theme }} embed embedOptions={embedOptions}>
        <EmbedDisabledNotice label="agenda" />
      </PublicEventShell>
    );
  }

  const schedule = await getPublishedSchedule(eventSlug);
  if (!schedule) notFound();
  return <PublicAgenda eventSlug={eventSlug} schedule={schedule} embed embedOptions={embedOptions} filters={config.filters} />;
}
