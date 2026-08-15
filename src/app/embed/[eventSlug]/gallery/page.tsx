import type { Metadata } from "next";
import { PublicSpeakerGallery } from "@/features/public/public-speaker-gallery";
import { getPublicEmbedConfig } from "@/features/public/server/embed-config-queries";
import { getPublicEventIsDemo, getPublishedSpeakers } from "@/features/public/server/public-queries";
import { renderEmbedSurface } from "../embed-page";

/** First Fair (design §6.3) — see `agenda/page.tsx`'s identical comment. */
export async function generateMetadata({ params }: { params: Promise<{ eventSlug: string }> }): Promise<Metadata> {
  const { eventSlug } = await params;
  const isDemo = await getPublicEventIsDemo(eventSlug);
  return { title: "Speaker gallery", ...(isDemo ? { robots: { index: false, follow: false } } : {}) };
}

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
    getContent: getPublishedSpeakers,
    renderContent: (speakers, context) => <PublicSpeakerGallery {...context} speakers={speakers} embed />,
  });
}
