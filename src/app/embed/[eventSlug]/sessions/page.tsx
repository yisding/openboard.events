import { notFound } from "next/navigation";
import { getEventBySlug } from "@/features/events";
import { EmbedDisabledNotice } from "@/features/public/embed-disabled-notice";
import { PublicEventShell } from "@/features/public/public-event-shell";
import { PublicSessions } from "@/features/public/public-sessions";
import { getOrCreateEmbedConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSchedule } from "@/features/public/server/public-queries";
import { parseEmbedOptions } from "../embed-options";

export default async function Page({ params, searchParams }: { params: Promise<{ eventSlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) notFound();

  const embedOptions = parseEmbedOptions(await searchParams);

  // The kill switch (and content filters) are read from the saved config,
  // not the iframe URL, so an already-embedded iframe picks up a later save
  // without the embedder having to regenerate their snippet. This check runs
  // before any published-data read (M33 work order guardrail): a disabled
  // embed never even calls `getPublishedSchedule`.
  const config = await getOrCreateEmbedConfig(event.id, "session_list");
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
