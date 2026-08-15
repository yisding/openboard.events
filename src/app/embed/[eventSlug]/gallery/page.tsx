import type { Metadata } from "next";
import { PublicSpeakerGallery } from "@/features/public/public-speaker-gallery";
import { getPublicEmbedConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSchedule, getPublishedSpeakers } from "@/features/public/server/public-queries";
import { renderEmbedSurface } from "../embed-page";

export const metadata: Metadata = { title: "Speaker gallery" };

/** See `/e/**`'s identical comment: never read `searchParams` here, or this
 * route loses the edge cache (status.md rev. 11's "known regression",
 * fixed). Style now comes from the config row fetched below. */
export const revalidate = 60;

export async function generateStaticParams(): Promise<Array<{ eventSlug: string }>> {
  return [];
}

export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  return renderEmbedSurface({
    eventSlug,
    active: "gallery",
    disabledLabel: "speaker gallery",
    getConfig: (eventId) => getPublicEmbedConfig(eventId, "speaker_gallery"),
    // The schedule comes along only so the empty state knows whether pointing
    // at the agenda is a live destination — see `public-speaker-gallery.tsx`.
    getContent: async (slug) => {
      const [speakers, schedule] = await Promise.all([getPublishedSpeakers(slug), getPublishedSchedule(slug)]);
      return speakers ? { speakers, hasSessions: (schedule?.sessions.length ?? 0) > 0 } : null;
    },
    renderContent: ({ speakers, hasSessions }, context) => <PublicSpeakerGallery {...context} speakers={speakers} hasSessions={hasSessions} embed />,
  });
}
