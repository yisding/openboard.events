import type { Metadata } from "next";
import { AgendaPage } from "@/features/agenda/agenda-page";

export const metadata: Metadata = { title: "Agenda" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <AgendaPage eventId={eventId} />;
}
