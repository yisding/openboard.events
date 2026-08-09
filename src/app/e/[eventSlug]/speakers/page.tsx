import type { Metadata } from "next";
import { Suspense } from "react";
import { PublicSpeakers } from "@/features/public/public-speakers";

export const metadata: Metadata = { title: "Event speakers" };

/** Same cache contract as the schedule page. */
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
  return (
    <Suspense>
      <PublicSpeakers eventSlug={eventSlug} />
    </Suspense>
  );
}
