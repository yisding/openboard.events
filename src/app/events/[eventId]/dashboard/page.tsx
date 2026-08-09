import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/features/auth";
import { getOverview } from "@/features/dashboard";
import { DashboardTabs } from "@/features/dashboard/index.client";
import { DashboardLoadError, type DashboardTab } from "@/features/dashboard/components/DashboardTabs";
import { eventIdSchema } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { FIXTURE_OVERVIEW } from "@/features/dashboard/fixtures";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const parsedEventId = eventIdSchema.safeParse((await params).eventId);
  if (!parsedEventId.success) notFound();
  const eventId = parsedEventId.data;
  const localDemo = isCredentialFreeLocalDemo();
  if (localDemo) {
    const overview = { ...FIXTURE_OVERVIEW, event: { ...FIXTURE_OVERVIEW.event, id: eventId } };
    return <DashboardTabs eventId={eventId} initialData={overview} initialTab="speakers" firstName="Maya" live={false} />;
  }
  const session = await requireAdmin(eventId, "organizer");
  let overview;
  try {
    overview = await getOverview(eventId);
  } catch (error) {
    console.error("dashboard.overview_failed", { eventId, error });
    return <DashboardLoadError />;
  }
  const requestedTab = (await searchParams).tab;
  const defaultTab: DashboardTab = overview.speakerTracking.acceptedSpeakers > 0 ? "speakers" : "today";
  const initialTab: DashboardTab = requestedTab === "today" || requestedTab === "speakers" ? requestedTab : defaultTab;
  const firstName = session.name.trim().split(/\s+/, 1)[0] || "Organizer";
  return <DashboardTabs eventId={eventId} initialData={overview} initialTab={initialTab} firstName={firstName} />;
}
