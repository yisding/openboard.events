import { notFound } from "next/navigation";
import { getEventBySlug } from "@/features/events";
import { EmbedDisabledNotice } from "@/features/public/embed-disabled-notice";
import { PublicEventShell } from "@/features/public/public-event-shell";
import { PublicSessions } from "@/features/public/public-sessions";
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

  // The kill switch, style, and content filters are all read from the saved
  // config, not the iframe URL, so an already-embedded iframe picks up a
  // later save without the embedder having to regenerate their snippet.
  // This check runs before any published-data read (M33 work order
  // guardrail): a disabled embed never even calls `getPublishedSchedule`.
  const config = await getOrCreateEmbedConfig(event.id, "session_list");
  const embedOptions = resolveEmbedOptions(config.style);
  if (!config.enabled) {
    return (
      <PublicEventShell active="sessions" eventSlug={eventSlug} event={{ name: event.name, timezone: event.timezone, accentColor: event.theme }} embed embedOptions={embedOptions}>
        <EmbedDisabledNotice label="sessions list" />
      </PublicEventShell>
    );
  }

  const schedule = await getPublishedSchedule(eventSlug);
  if (!schedule) notFound();
  return <PublicSessions eventSlug={eventSlug} schedule={schedule} embed embedOptions={embedOptions} filters={config.filters} />;
}
