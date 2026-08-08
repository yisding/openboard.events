import type { Metadata } from "next";
import { ResourcesAdminPage } from "@/features/portal/resources-admin-page";

export const metadata: Metadata = { title: "Resources" };
export default async function Page({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <ResourcesAdminPage eventId={eventId} />;
}
