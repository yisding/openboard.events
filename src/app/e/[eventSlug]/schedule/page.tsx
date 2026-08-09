import type { Metadata } from "next";
import { PublicSchedule } from "@/features/public/public-schedule";

export const metadata: Metadata = { title: "Event schedule" };

/**
 * CP0's revalidate-60 item, and the header `scripts/post-deploy-smoke.sh`
 * asserts: a public page must be edge-cacheable, or every visitor during a
 * keynote rush becomes an origin request. The client view reads URL filters
 * after hydration, so its complete default schedule remains in the cached HTML.
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
  return <PublicSchedule eventSlug={eventSlug} />;
}
