import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicAgenda } from "@/features/public/public-agenda";
import { PublicBuildMarker } from "@/features/public/public-build-marker";
import { getPublicEventIsDemo, getPublishedSchedule } from "@/features/public/server/public-queries";
import { getEnv } from "@/shared/lib/env";

/**
 * First Fair (design §6.3) — converted from a static `metadata` const because
 * a static export cannot read the event row. `robots: { index: false }` is
 * the demo's public-exposure rail: fabricated speakers never enter a search
 * index, even once Chapter 8 publishes the agenda.
 */
export async function generateMetadata({ params }: { params: Promise<{ eventSlug: string }> }): Promise<Metadata> {
  const { eventSlug } = await params;
  const isDemo = await getPublicEventIsDemo(eventSlug);
  return { title: "Agenda", ...(isDemo ? { robots: { index: false, follow: false } } : {}) };
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
  const env = getEnv();
  return (
    <>
      <PublicBuildMarker deploymentId={env.DEPLOYMENT_ID ?? "local"} />
      <PublicAgenda eventSlug={eventSlug} schedule={schedule} />
    </>
  );
}
