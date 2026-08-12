"use client";

import Link from "next/link";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { EventId } from "@/shared/contracts";
import type { DashboardOverview } from "../index";
import { useDashboardOverview } from "../hooks/use-dashboard-overview";
import { computeEventPhase } from "../lib/phase";
import { ActivationGuide } from "./ActivationGuide";
import { AttentionQueue } from "./AttentionQueue";
import { MilestoneBanner } from "./MilestoneBanner";
import { SpeakerTrackingPanel } from "./SpeakerTrackingPanel";
import { TodayPanel } from "./TodayPanel";
import { WidgetBoundary } from "./WidgetBoundary";

export type DashboardTab = "today" | "speakers";

export function DashboardTabNav({ eventId, active }: { eventId: EventId; active: DashboardTab }) {
  return <nav className="dashboard-tabs" aria-label="Dashboard sections">
    <Link className={active === "speakers" ? "active" : ""} aria-current={active === "speakers" ? "page" : undefined} href={`/events/${eventId}/dashboard?tab=speakers`}>Speaker Tracking</Link>
    <Link className={active === "today" ? "active" : ""} aria-current={active === "today" ? "page" : undefined} href={`/events/${eventId}/dashboard?tab=today`}>Today</Link>
  </nav>;
}

export function DashboardTabs(props: { eventId: EventId; initialData: DashboardOverview; initialTab: DashboardTab; firstName: string; live?: boolean }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><DashboardTabsInner {...props} /></QueryClientProvider>;
}

function DashboardTabsInner({ eventId, initialData, initialTab, firstName, live = true }: { eventId: EventId; initialData: DashboardOverview; initialTab: DashboardTab; firstName: string; live?: boolean }) {
  const query = useDashboardOverview(eventId, initialData, live);
  const overview = query.data;
  const phase = computeEventPhase(overview);
  return <main className="dashboard-page dashboard-live">
    <header className="dashboard-live-header"><div><span>Dashboard</span><h1>{overview.event.name}</h1><p>Live event health from one event-scoped overview.</p></div><div className="dashboard-live-state"><i className={query.isFetching ? "polling" : ""} />{query.isFetching ? "Refreshing" : live ? "Updates every 30 seconds" : "Local fixture preview"}</div></header>
    {query.isError && <div className="dashboard-stale-banner" role="status">The latest refresh failed. Showing the last good overview.<button type="button" onClick={() => void query.refetch()}><RefreshCw size={14} /> Retry</button></div>}
    <WidgetBoundary name="activation"><ActivationGuide overview={overview} /></WidgetBoundary>
    {/* M56 — the dashboard leads with this, above the tabs, so it is the
        answer regardless of which tab is open. Below it, the two tabs stay
        the same detail views they always were. */}
    <WidgetBoundary name="attention"><AttentionQueue items={overview.attention} /></WidgetBoundary>
    {/* M60 — one-time positive facts, distinct from the attention queue's
        ongoing work: each stays true once crossed, so this is what
        remembers "already celebrated" rather than recomputing urgency. */}
    <WidgetBoundary name="milestones"><MilestoneBanner eventId={eventId} overview={overview} /></WidgetBoundary>
    <DashboardTabNav eventId={eventId} active={initialTab} />
    {initialTab === "speakers" ? <SpeakerTrackingPanel overview={overview} /> : <TodayPanel overview={overview} firstName={firstName} phase={phase} />}
  </main>;
}

export function DashboardLoadError() {
  return <main className="dashboard-page dashboard-load-error"><div><RefreshCw size={22} /><b>Dashboard data couldn’t be loaded.</b><span>Check the connection and try again.</span></div><button className="button button-primary" type="button" onClick={() => window.location.reload()}>Retry</button></main>;
}
