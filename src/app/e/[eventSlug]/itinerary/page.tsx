import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicItinerary } from "@/features/public/public-itinerary";
import { getPublicEventIsDemo, getPublishedSchedule } from "@/features/public/server/public-queries";

/** First Fair (design §6.3) — see `agenda/page.tsx`'s identical comment. */
export async function generateMetadata({ params }: { params: Promise<{ eventSlug: string }> }): Promise<Metadata> {
  const { eventSlug } = await params;
  const isDemo = await getPublicEventIsDemo(eventSlug);
  return { title: "My schedule", ...(isDemo ? { robots: { index: false, follow: false } } : {}) };
}

/** Same cache contract as every other public surface — see sessions/page.tsx. */
export const revalidate = 60;

export async function generateStaticParams(): Promise<Array<{ eventSlug: string }>> {
  return [];
}

export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const schedule = await getPublishedSchedule(eventSlug);
  if (!schedule) notFound();
  return <PublicItinerary eventSlug={eventSlug} schedule={schedule} />;
}
