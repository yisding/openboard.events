import type { Metadata } from "next";
import { AbstractsPage } from "@/features/submissions/abstracts-page";

export const metadata: Metadata = { title: "Abstracts" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <AbstractsPage eventId={eventId} />;
}
