"use client";

import Link from "next/link";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { EventId } from "@/shared/contracts";
import type { DashboardOverview } from "../index";
import { useDashboardOverview } from "../hooks/use-dashboard-overview";
import { SpeakerTrackingPanel } from "./SpeakerTrackingPanel";
import { TodayPanel } from "./TodayPanel";

export type DashboardTab = "today" | "speakers";

export function DashboardTabs(props: { eventId: EventId; initialData: DashboardOverview; initialTab: DashboardTab; firstName: string }) {
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}><DashboardTabsInner {...props} /></QueryClientProvider>;
}

function DashboardTabsInner({ eventId, initialData, initialTab, firstName }: { eventId: EventId; initialData: DashboardOverview; initialTab: DashboardTab; firstName: string }) {
  const query = useDashboardOverview(eventId, initialData);
  const overview = query.data;
  return <main className="dashboard-page dashboard-live">
    <header className="dashboard-live-header"><div><span>Dashboard</span><h1>{overview.event.name}</h1><p>Live event health from one event-scoped overview.</p></div><div className="dashboard-live-state"><i className={query.isFetching ? "polling" : ""} />{query.isFetching ? "Refreshing" : "Updates every 30 seconds"}</div></header>
    {query.isError && <div className="dashboard-stale-banner" role="status">The latest refresh failed. Showing the last good overview.<button type="button" onClick={() => void query.refetch()}><RefreshCw size={14} /> Retry</button></div>}
    <nav className="dashboard-tabs" aria-label="Dashboard sections">
      <Link className={initialTab === "speakers" ? "active" : ""} href={`/events/${eventId}/dashboard?tab=speakers`}>Speaker Tracking</Link>
      <Link className={initialTab === "today" ? "active" : ""} href={`/events/${eventId}/dashboard?tab=today`}>Today</Link>
    </nav>
    {initialTab === "speakers" ? <SpeakerTrackingPanel overview={overview} /> : <TodayPanel overview={overview} firstName={firstName} />}
  </main>;
}

export function DashboardLoadError() {
  return <main className="dashboard-page dashboard-load-error"><div><RefreshCw size={22} /><b>Dashboard data couldn’t be loaded.</b><span>Check the connection and try again.</span></div><button className="button button-primary" type="button" onClick={() => window.location.reload()}>Retry</button></main>;
}
