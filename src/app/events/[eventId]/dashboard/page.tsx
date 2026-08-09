import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/features/auth";
import { getOverview } from "@/features/dashboard";
import { DashboardTabs } from "@/features/dashboard/index.client";
import { DashboardLoadError, type DashboardTab } from "@/features/dashboard/components/DashboardTabs";
import { resolveDashboardTab, resolveLocalDashboardEventId } from "@/features/dashboard/lib/dashboard-tab";
import { eventIdSchema, type EventId } from "@/shared/contracts";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { FIXTURE_OVERVIEW } from "@/features/dashboard/fixtures";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const requestedEventId = (await params).eventId;
  const requestedTab = (await searchParams).tab;
  const localDemo = isCredentialFreeLocalDemo();
  if (localDemo) {
    const eventId = resolveLocalDashboardEventId(requestedEventId);
    if (!eventId) notFound();
    // The credential-free fixture deliberately uses a readable non-UUID id;
    // `live=false` guarantees it never reaches a database/API boundary.
    const localEventId = eventId as EventId;
    const overview = { ...FIXTURE_OVERVIEW, event: { ...FIXTURE_OVERVIEW.event, id: localEventId } };
    const initialTab = resolveDashboardTab(requestedTab, "speakers");
    return <DashboardTabs eventId={localEventId} initialData={overview} initialTab={initialTab} firstName="Maya" live={false} />;
  }
  const parsedEventId = eventIdSchema.safeParse(requestedEventId);
  if (!parsedEventId.success) notFound();
  const eventId = parsedEventId.data;
  const session = await requireAdmin(eventId, "organizer");
  let overview;
  try {
    overview = await getOverview(eventId);
  } catch (error) {
    console.error("dashboard.overview_failed", { eventId, error });
    return <DashboardLoadError />;
  }
  const defaultTab: DashboardTab = overview.speakerTracking.acceptedSpeakers > 0 ? "speakers" : "today";
  const initialTab = resolveDashboardTab(requestedTab, defaultTab);
  const firstName = session.name.trim().split(/\s+/, 1)[0] || "Organizer";
  return <DashboardTabs eventId={eventId} initialData={overview} initialTab={initialTab} firstName={firstName} />;
}
