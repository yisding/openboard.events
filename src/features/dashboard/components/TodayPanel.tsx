import type { DashboardOverview } from "../index";
import { formatInZone, hourMinuteInZone } from "@/shared/lib/time";
import { AttentionStrip } from "./AttentionStrip";
import { FormProgressCards } from "./FormProgressCards";
import { KpiRow } from "./KpiRow";
import { RecentSubmissionsTable } from "./RecentSubmissionsTable";
import { StatusRow } from "./StatusRow";
import { WidgetBoundary } from "./WidgetBoundary";

function dayKicker(timezone: string, days: number): string {
  const date = formatInZone(new Date(), timezone, { weekday: "long", month: "long", day: "numeric" });
  const countdown = days === 0 ? "EVENT DAY" : days > 0 ? `${days} DAYS TO EVENT` : `${Math.abs(days)} DAYS SINCE EVENT`;
  return `${date.toUpperCase()} · ${countdown}`;
}

function greeting(timezone: string): string {
  const { hour } = hourMinuteInZone(new Date(), timezone);
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

export function TodayPanel({ overview, firstName }: { overview: DashboardOverview; firstName: string }) {
  return <div className="dashboard-tab-panel">
    <header className="dashboard-greeting"><span>{dayKicker(overview.event.timezone, overview.event.daysToEvent)}</span><h1>{greeting(overview.event.timezone)}, {firstName}</h1><p>Here’s what needs your attention for {overview.event.name}.</p></header>
    <WidgetBoundary name="kpis"><KpiRow kpis={overview.kpis} /></WidgetBoundary>
    <WidgetBoundary name="attention"><AttentionStrip items={overview.attention} /></WidgetBoundary>
    <WidgetBoundary name="statuses"><StatusRow counts={overview.statusCounts} /></WidgetBoundary>
    <div className="dashboard-today-grid">
      <WidgetBoundary name="forms"><FormProgressCards eventId={overview.event.id} eventSlug={overview.event.slug} timezone={overview.event.timezone} forms={overview.forms} /></WidgetBoundary>
      <WidgetBoundary name="recent-submissions"><RecentSubmissionsTable eventId={overview.event.id} timezone={overview.event.timezone} rows={overview.recentSubmissions} /></WidgetBoundary>
    </div>
  </div>;
}
