import type { DashboardOverview } from "../index";
import { formatInZone, hourMinuteInZone } from "@/shared/lib/time";
import type { EventPhase } from "../lib/phase";
import { FormProgressCards } from "./FormProgressCards";
import { KpiRow } from "./KpiRow";
import { RecentSubmissionsTable } from "./RecentSubmissionsTable";
import { StatusRow } from "./StatusRow";
import { WidgetBoundary } from "./WidgetBoundary";

function dayKicker(timezone: string, days: number): string {
  const date = formatInZone(new Date(), timezone, { weekday: "long", month: "long", day: "numeric" });
  const countdown = days === 0 ? "Event day" : days > 0 ? `${days} days to event` : `${Math.abs(days)} days since event`;
  return `${date} · ${countdown}`;
}

function greeting(timezone: string): string {
  const { hour } = hourMinuteInZone(new Date(), timezone);
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/**
 * M56 — the two widgets in `dashboard-today-grid` swap lead position by
 * phase: while a form is still open the submission count climbing is the
 * story (forms first); once decisions are the day's work, what just came in
 * is more useful up top than a static form card. Same two components either
 * way — this is reordering, not a new widget.
 */
function FormsAndRecent({ overview, phase }: { overview: DashboardOverview; phase: EventPhase }) {
  const forms = <WidgetBoundary name="forms" key="forms"><FormProgressCards eventId={overview.event.id} eventSlug={overview.event.slug} timezone={overview.event.timezone} forms={overview.forms} /></WidgetBoundary>;
  const recent = <WidgetBoundary name="recent-submissions" key="recent-submissions"><RecentSubmissionsTable eventId={overview.event.id} timezone={overview.event.timezone} rows={overview.recentSubmissions} /></WidgetBoundary>;
  return phase === "cfp" ? <>{forms}{recent}</> : <>{recent}{forms}</>;
}

export function TodayPanel({ overview, firstName, phase = "cfp" }: { overview: DashboardOverview; firstName: string; phase?: EventPhase }) {
  return <div className="dashboard-tab-panel">
    <p className="dashboard-greeting">{greeting(overview.event.timezone)}, {firstName} <span aria-hidden="true">·</span> {dayKicker(overview.event.timezone, overview.event.daysToEvent)}</p>
    <WidgetBoundary name="statuses"><StatusRow counts={overview.statusCounts} /></WidgetBoundary>
    <div className="dashboard-today-grid">
      <FormsAndRecent overview={overview} phase={phase} />
    </div>
    {/* KPI tiles demoted below the fold (experience-design.md Surfacing #1):
        the attention queue above the tabs already answers "what should I do
        next" — these are the report a reader scrolls to only once that
        question is answered. */}
    <WidgetBoundary name="kpis"><KpiRow kpis={overview.kpis} /></WidgetBoundary>
  </div>;
}
