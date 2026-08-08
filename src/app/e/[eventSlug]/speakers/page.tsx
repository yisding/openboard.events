import type { Metadata } from "next";
import { PublicSpeakers } from "@/features/public/public-speakers";

export const metadata: Metadata = { title: "Speakers · AI Engineer World’s Fair" };
export default async function Page({ params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  return <PublicSpeakers eventSlug={eventSlug} />;
}
