import { PublicItinerary } from "@/features/public/public-itinerary";
import { getOrCreateEmbedConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSchedule } from "@/features/public/server/public-queries";
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
    active: "itinerary",
    disabledLabel: "schedule itinerary",
    getConfig: (eventId) => getOrCreateEmbedConfig(eventId, "schedule_itinerary"),
    getContent: getPublishedSchedule,
    renderContent: (schedule, context) => <PublicItinerary {...context} schedule={schedule} embed />,
  });
}
