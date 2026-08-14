import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/features/auth";
import { getOverview } from "@/features/dashboard";
import { DashboardTabs } from "@/features/dashboard/index.client";
import { DashboardLoadError, type DashboardTab } from "@/features/dashboard/components/DashboardTabs";
import { resolveDashboardTab } from "@/features/dashboard/lib/dashboard-tab";
import { computeEventPhase, defaultTabForPhase } from "@/features/dashboard/lib/phase";
import { eventIdSchema } from "@/shared/contracts";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const requestedEventId = (await params).eventId;
  const requestedTab = (await searchParams).tab;
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
  // M56 — the default tab follows the event's lifecycle phase (same law as
  // the widget reordering below it), not a bare "any accepted speaker" check.
  const defaultTab: DashboardTab = defaultTabForPhase(computeEventPhase(overview));
  const initialTab = resolveDashboardTab(requestedTab, defaultTab);
  const firstName = session.name.trim().split(/\s+/, 1)[0] || "Organizer";
  return <DashboardTabs eventId={eventId} serverOverview={overview} initialTab={initialTab} firstName={firstName} />;
}
