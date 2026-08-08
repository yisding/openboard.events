import type { Metadata } from "next";
import { SpeakersPage } from "@/features/portal/speakers-page";

export const metadata: Metadata = { title: "Speakers" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <SpeakersPage eventId={eventId} />;
}
