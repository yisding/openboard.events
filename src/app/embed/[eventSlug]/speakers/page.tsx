import type { Metadata } from "next";
import { PublicSpeakersList } from "@/features/public/public-speakers-list";
import { getOrCreateSpeakerListConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSpeakers } from "@/features/public/server/public-queries";
import { renderEmbedSurface } from "../embed-page";

export const metadata: Metadata = { title: "Speakers" };

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
    active: "speakers",
    disabledLabel: "speakers list",
    getConfig: getOrCreateSpeakerListConfig,
    getContent: getPublishedSpeakers,
    renderContent: (speakers, context) => <PublicSpeakersList {...context} speakers={speakers} embed />,
  });
}
