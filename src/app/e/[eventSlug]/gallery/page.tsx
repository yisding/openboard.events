import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicSpeakerGallery } from "@/features/public/public-speaker-gallery";
import { getPublishedSpeakers } from "@/features/public/server/public-queries";

export const metadata: Metadata = { title: "Speaker gallery" };

/** Same cache contract as every other public surface — see sessions/page.tsx. */
export const revalidate = 60;

export async function generateStaticParams(): Promise<Array<{ eventSlug: string }>> {
  return [];
}

export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const speakers = await getPublishedSpeakers(eventSlug);
  if (!speakers) notFound();
  return <PublicSpeakerGallery eventSlug={eventSlug} speakers={speakers} />;
}
