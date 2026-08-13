import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicAgenda } from "@/features/public/public-agenda";
import { PublicBuildMarker } from "@/features/public/public-build-marker";
import { getPublishedSchedule } from "@/features/public/server/public-queries";
import { getEnv } from "@/shared/lib/env";

export const metadata: Metadata = { title: "Agenda" };

/** Same cache contract as every other public surface — see sessions/page.tsx. */
export const revalidate = 60;

export async function generateStaticParams(): Promise<Array<{ eventSlug: string }>> {
  return [];
}

export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const schedule = await getPublishedSchedule(eventSlug);
  if (!schedule) notFound();
  return (
    <>
      <PublicBuildMarker sha={getEnv().NEXT_PUBLIC_BUILD_SHA ?? "local"} />
      <PublicAgenda eventSlug={eventSlug} schedule={schedule} />
    </>
  );
}
