import type { Metadata } from "next";
import { PublicSpeakersList } from "@/features/public/public-speakers-list";
import { getPublicEmbedConfig } from "@/features/public/server/embed-config-queries";
import { getPublicEventIsDemo, getPublishedSchedule, getPublishedSpeakers } from "@/features/public/server/public-queries";
import { renderEmbedSurface } from "../embed-page";

/** First Fair (design §6.3) — see `agenda/page.tsx`'s identical comment. */
export async function generateMetadata({ params }: { params: Promise<{ eventSlug: string }> }): Promise<Metadata> {
  const { eventSlug } = await params;
  const isDemo = await getPublicEventIsDemo(eventSlug);
  return { title: "Speakers", ...(isDemo ? { robots: { index: false, follow: false } } : {}) };
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
    active: "speakers",
    disabledLabel: "speakers list",
    getConfig: (eventId) => getPublicEmbedConfig(eventId, "speaker_list"),
    // The schedule comes along only so the empty state knows whether pointing
    // at the agenda is a live destination — see `public-speakers-list.tsx`.
    getContent: async (slug) => {
      const [speakers, schedule] = await Promise.all([getPublishedSpeakers(slug), getPublishedSchedule(slug)]);
      return speakers ? { speakers, hasSessions: (schedule?.sessions.length ?? 0) > 0 } : null;
    },
    renderContent: ({ speakers, hasSessions }, context) => <PublicSpeakersList {...context} speakers={speakers} hasSessions={hasSessions} embed />,
  });
}
