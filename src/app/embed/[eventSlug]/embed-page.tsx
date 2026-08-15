import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getEventBySlug } from "@/features/events";
import type { EventId } from "@/features/public/embed-config-types";
import { EmbedDisabledNotice } from "@/features/public/embed-disabled-notice";
import type { PublicEmbedConfig } from "@/features/public/server/embed-config-queries";
import {
  PublicEventShell,
  type EmbedOptions,
  type PublicSurface,
} from "@/features/public/public-event-shell";
import { asAccentColor } from "@/shared/lib/brand-color";
import { resolveEmbedOptions } from "./embed-options";

type EmbedContentContext = {
  eventSlug: string;
  embedOptions: EmbedOptions;
  filters: PublicEmbedConfig["filters"];
};

type EmbedSurfaceOptions<Content> = {
  eventSlug: string;
  active: PublicSurface;
  disabledLabel: string;
  getConfig: (eventId: EventId) => Promise<PublicEmbedConfig>;
  getContent: (eventSlug: string) => Promise<Content | null>;
  renderContent: (content: Content, context: EmbedContentContext) => ReactNode;
};

/**
 * Shared server-side contract for every embed surface. Config is deliberately
 * resolved before published content so a disabled embed never performs the
 * more expensive public-data query.
 */
export async function renderEmbedSurface<Content>({
  eventSlug,
  active,
  disabledLabel,
  getConfig,
  getContent,
  renderContent,
}: EmbedSurfaceOptions<Content>): Promise<ReactNode> {
  const event = await getEventBySlug(eventSlug);
  if (!event) notFound();

  const config = await getConfig(event.id);
  const embedOptions = resolveEmbedOptions(config.style);
  if (!config.enabled) {
    return (
      <PublicEventShell
        active={active}
        eventSlug={eventSlug}
        event={{ name: event.name, timezone: event.timezone, accentColor: asAccentColor(event.theme) }}
        embed
        embedOptions={embedOptions}
      >
        <EmbedDisabledNotice label={disabledLabel} />
      </PublicEventShell>
    );
  }

  const content = await getContent(eventSlug);
  if (!content) notFound();
  return renderContent(content, { eventSlug, embedOptions, filters: config.filters });
}
