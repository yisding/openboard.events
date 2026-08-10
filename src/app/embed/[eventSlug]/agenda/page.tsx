import { notFound } from "next/navigation";
import { getEventBySlug } from "@/features/events";
import { EmbedDisabledNotice } from "@/features/public/embed-disabled-notice";
import { PublicAgenda } from "@/features/public/public-agenda";
import { PublicEventShell } from "@/features/public/public-event-shell";
import { getOrCreateEmbedConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSchedule } from "@/features/public/server/public-queries";
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
  const config = await getOrCreateEmbedConfig(event.id, "agenda");
  const embedOptions = resolveEmbedOptions(config.style);
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
