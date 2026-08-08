import type { Metadata } from "next";
import { FormsPage } from "@/features/forms/forms-page";

export const metadata: Metadata = { title: "Forms" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <FormsPage eventId={eventId} />;
}
