"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { EventId } from "@/shared/contracts";
import { QueryBoundary } from "@/shared/ui/app/query-boundary";
import { Button } from "@/shared/ui/ui-kit";
import type { DashboardOverview } from "../index";
import { dashboardKeys, useDashboardOverview } from "../hooks/use-dashboard-overview";
import { computeEventPhase } from "../lib/phase";
import { ActivationGuide } from "./ActivationGuide";
import { AttentionQueue } from "./AttentionQueue";
import { MilestoneBanner } from "./MilestoneBanner";
import { SpeakerTrackingPanel } from "./SpeakerTrackingPanel";
import { TodayPanel } from "./TodayPanel";
import { TourResumeCard } from "./TourResumeCard";
import { WidgetBoundary } from "./WidgetBoundary";

export type DashboardTab = "today" | "speakers";

/**
 * First Fair (design §3.9) — everything the dashboard needs to know about a
 * guided tour, and nothing more.
 *
 * The dashboard has no business knowing what a demo event is, so the route
 * module resolves the cursor and hands down this flat shape. `resume` present
 * means "the tutorial is waiting and this slot is its"; `tourHref` present on
 * a **real** event means "this organizer has never finished the tour and the
 * launch guide may offer it".
 */
export type DashboardTourState = {
  /** Suppresses the milestone banner and the launch guide: one voice at a time. */
  isDemo: boolean;
  /**
   * Present when the tutorial owes the organizer a way back in: it is paused,
   * or it is running on a cursor the engine cannot draw a card for (`stranded`),
   * which is the one case where an *active* tour leaves the screen empty.
   */
  resume?: { chapter: string; stepId: string; chapterLabel: string; percent: number; resumeHref: string; stranded?: true };
  tourHref?: string;
};

export function DashboardTabNav({ eventId, active }: { eventId: EventId; active: DashboardTab }) {
  return <nav className="dashboard-tabs" aria-label="Dashboard sections">
    <Link className={active === "speakers" ? "active" : ""} aria-current={active === "speakers" ? "page" : undefined} href={`/events/${eventId}/dashboard?tab=speakers`}>Speaker Tracking</Link>
    <Link className={active === "today" ? "active" : ""} aria-current={active === "today" ? "page" : undefined} href={`/events/${eventId}/dashboard?tab=today`}>Today</Link>
  </nav>;
}

type DashboardTabsProps = {
  eventId: EventId;
  initialTab: DashboardTab;
  firstName: string;
  live?: boolean;
  /** Absent on every event that has no tutorial to speak of, which is most of them. */
  tour?: DashboardTourState;
  /** Used only to hydrate the query boundary; the live view never receives a second prop copy. */
  serverOverview: DashboardOverview;
};

export function DashboardTabs({ serverOverview, ...props }: DashboardTabsProps) {
  const seeds = [{ queryKey: dashboardKeys.overview(props.eventId), data: serverOverview }];
  return <QueryBoundary seeds={seeds}><DashboardTabsInner {...props} /></QueryBoundary>;
}

function DashboardTabsInner({ eventId, initialTab, firstName, live = true, tour }: Omit<DashboardTabsProps, "serverOverview">) {
  const query = useDashboardOverview(eventId, live);
  if (!query.data) return <DashboardLoadError />;
  return <DashboardTabsView
    eventId={eventId}
    firstName={firstName}
    initialTab={initialTab}
    isError={query.isError}
    isFetching={query.isFetching}
    live={live}
    onRetry={() => void query.refetch()}
    overview={query.data}
    {...(tour ? { tour } : {})}
  />;
}

export function DashboardTabsView({ eventId, firstName, initialTab, isError = false, isFetching = false, live = true, onRetry = () => undefined, overview, tour }: {
  eventId: EventId;
  firstName: string;
  initialTab: DashboardTab;
  isError?: boolean;
  isFetching?: boolean;
  live?: boolean;
  onRetry?: () => void;
  overview: DashboardOverview;
  tour?: DashboardTourState;
}) {
  const phase = computeEventPhase(overview);
  return <div className="dashboard-page dashboard-live">
    <header className="dashboard-live-header"><div><span>Dashboard</span><h1>{overview.event.name}</h1><p>Live event health from one event-scoped overview.</p></div><div className="dashboard-live-state"><i aria-hidden="true" className={isFetching ? "polling" : ""} />{isFetching ? "Refreshing" : live ? "Updates every 30 seconds" : "Local fixture preview"}</div></header>
    {isError && <div className="dashboard-stale-banner" role="status">The latest refresh failed. Showing the last good overview.<button type="button" onClick={onRetry}><RefreshCw size={14} /> Retry</button></div>}
    {/* M56 — the dashboard leads with this, above the tabs, so it is the
        answer regardless of which tab is open. Below it, the two tabs stay
        the same detail views they always were. */}
    <WidgetBoundary name="attention"><AttentionQueue items={overview.attention} /></WidgetBoundary>
    <DashboardTabNav eventId={eventId} active={initialTab} />
    {/* M60 — one-time positive facts, distinct from the attention queue's
        ongoing work. Milestones and the launch guide are dashboard content,
        not peers of the event heading or priority queue, so both follow the
        primary navigation. */}
    {/* First Fair (design §3.9) — on a demo event the tutorial owns this
        slot outright. The milestone banner and the launch guide exist to
        activate a *real* event, and three onboarding voices talking over each
        other is worse than any one of them alone. */}
    {!tour?.isDemo && <WidgetBoundary name="milestones"><MilestoneBanner eventId={eventId} overview={overview} /></WidgetBoundary>}
    {tour?.resume
      ? <WidgetBoundary name="activation"><TourResumeCard eventId={eventId} {...tour.resume} /></WidgetBoundary>
      : <WidgetBoundary name="activation">
        <ActivationGuide overview={overview} isDemo={tour?.isDemo ?? false} demoTourHref={tour?.tourHref ?? null} />
      </WidgetBoundary>}
    {initialTab === "speakers" ? <SpeakerTrackingPanel overview={overview} /> : <TodayPanel overview={overview} firstName={firstName} phase={phase} />}
  </div>;
}

export function DashboardLoadError() {
  return <div className="dashboard-page dashboard-load-error"><div><RefreshCw size={22} /><b>Dashboard data couldn’t be loaded.</b><span>Check the connection and try again.</span></div><Button onClick={() => window.location.reload()}>Retry</Button></div>;
}
