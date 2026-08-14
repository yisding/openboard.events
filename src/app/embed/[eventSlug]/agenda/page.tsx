import type { Metadata } from "next";
import { PublicAgenda } from "@/features/public/public-agenda";
import { PublicBuildMarker } from "@/features/public/public-build-marker";
import { getPublicEmbedConfig } from "@/features/public/server/embed-config-queries";
import { getPublishedSchedule } from "@/features/public/server/public-queries";
import { getEnv } from "@/shared/lib/env";
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
  const content = await renderEmbedSurface({
    eventSlug,
    active: "agenda",
    disabledLabel: "agenda",
    getConfig: (eventId) => getPublicEmbedConfig(eventId, "agenda"),
    getContent: getPublishedSchedule,
    renderContent: (schedule, context) => <PublicAgenda {...context} schedule={schedule} embed />,
  });
  const env = getEnv();
  return (
    <>
      <PublicBuildMarker deploymentId={env.DEPLOYMENT_ID ?? "local"} />
      {content}
    </>
  );
}
