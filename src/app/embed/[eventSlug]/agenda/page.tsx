import type { Metadata } from "next";
import { PublicAgenda } from "@/features/public/public-agenda";
import { getOrCreateEmbedConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSchedule } from "@/features/public/server/public-queries";
import { renderEmbedSurface } from "../embed-page";

export const metadata: Metadata = { title: "Agenda" };

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
    active: "agenda",
    disabledLabel: "agenda",
    getConfig: (eventId) => getOrCreateEmbedConfig(eventId, "agenda"),
    getContent: getPublishedSchedule,
    renderContent: (schedule, context) => <PublicAgenda {...context} schedule={schedule} embed />,
  });
}
