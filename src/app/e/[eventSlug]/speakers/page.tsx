import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicSpeakersList } from "@/features/public/public-speakers-list";
import { getPublicEventIsDemo, getPublishedSchedule, getPublishedSpeakers } from "@/features/public/server/public-queries";

/** First Fair (design §6.3) — see `agenda/page.tsx`'s identical comment. */
export async function generateMetadata({ params }: { params: Promise<{ eventSlug: string }> }): Promise<Metadata> {
  const { eventSlug } = await params;
  const isDemo = await getPublicEventIsDemo(eventSlug);
  return { title: "Speakers", ...(isDemo ? { robots: { index: false, follow: false } } : {}) };
}

/** Same cache contract as every other public surface. */
export const revalidate = 60;

/**
 * Empty on purpose: no slug is known at build time. Declaring it is what marks
 * the route statically generatable, so an unknown slug renders once on demand
 * and is then served from the cache for the revalidate window.
 */
export async function generateStaticParams(): Promise<Array<{ eventSlug: string }>> {
  return [];
}

export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  // The schedule read is the same cached surface the agenda route uses; it
  // only decides whether this page's empty state may point at the agenda.
  const [speakers, schedule] = await Promise.all([getPublishedSpeakers(eventSlug), getPublishedSchedule(eventSlug)]);
  if (!speakers) notFound();
  return <PublicSpeakersList eventSlug={eventSlug} speakers={speakers} hasSessions={(schedule?.sessions.length ?? 0) > 0} />;
}
