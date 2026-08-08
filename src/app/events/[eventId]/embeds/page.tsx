import type { Metadata } from "next";
import { EmbedsAdminPage } from "@/features/public/embeds-admin-page";

export const metadata: Metadata = { title: "Embeds" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <EmbedsAdminPage eventId={eventId} />;
}
