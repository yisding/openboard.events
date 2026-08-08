import type { Metadata } from "next";
import { PublicSchedule } from "@/features/public/public-schedule";

export const metadata: Metadata = { title: "Event schedule" };
export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  return <PublicSchedule eventSlug={eventSlug} />;
}
