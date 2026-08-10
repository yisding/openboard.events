import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicSpeakersList } from "@/features/public/public-speakers-list";
import { getPublishedSpeakers } from "@/features/public/server/public-queries";

export const metadata: Metadata = { title: "Speakers" };

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
  const speakers = await getPublishedSpeakers(eventSlug);
  if (!speakers) notFound();
  return <PublicSpeakersList eventSlug={eventSlug} speakers={speakers} />;
}
