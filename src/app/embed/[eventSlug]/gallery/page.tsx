import { PublicSpeakerGallery } from "@/features/public/public-speaker-gallery";
import { getOrCreateEmbedConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSpeakers } from "@/features/public/server/public-queries";
import { renderEmbedSurface } from "../embed-page";

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
    getConfig: (eventId) => getOrCreateEmbedConfig(eventId, "speaker_gallery"),
    getContent: getPublishedSpeakers,
    renderContent: (speakers, context) => <PublicSpeakerGallery {...context} speakers={speakers} embed />,
  });
}
