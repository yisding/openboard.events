import type { Metadata } from "next";
import { PublicSchedule } from "@/features/public/public-schedule";

export const metadata: Metadata = { title: "Schedule · AI Engineer World’s Fair" };
export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  return <PublicSchedule eventSlug={eventSlug} />;
}
