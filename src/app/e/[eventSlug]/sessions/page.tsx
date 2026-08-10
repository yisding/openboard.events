import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicSessions } from "@/features/public/public-sessions";
import { getPublishedSchedule } from "@/features/public/server/public-queries";

export const metadata: Metadata = { title: "Sessions" };

/**
 * CP0's revalidate-60 item, and the header `scripts/post-deploy-smoke.sh`
 * asserts: a public page must be edge-cacheable, or every visitor during a
 * keynote rush becomes an origin request. The client view reads URL filters
 * after hydration, so its complete default list remains in the cached HTML —
 * this route never reads `searchParams`, which is what keeps it static.
 */
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
  const schedule = await getPublishedSchedule(eventSlug);
  if (!schedule) notFound();
  return <PublicSessions eventSlug={eventSlug} schedule={schedule} />;
}
