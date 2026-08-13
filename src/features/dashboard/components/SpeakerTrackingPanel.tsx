import type { DashboardOverview } from "../index";
import { ConfirmationMix } from "./ConfirmationMix";
import { MissingAssetsAlert } from "./MissingAssetsAlert";
import { OverdueList } from "./OverdueList";
import { TopSpeakersList } from "./TopSpeakersList";
import { WidgetBoundary } from "./WidgetBoundary";

export function SpeakerTrackingPanel({ overview }: { overview: DashboardOverview }) {
  const tracking = overview.speakerTracking;
  return <div className="dashboard-tab-panel">
    <section className="dashboard-stat-row">
      <article><span>Accepted speakers</span><strong>{tracking.acceptedSpeakers}</strong><p>Ready for event workflows</p></article>
      <article><span>Outstanding speaker tasks</span><strong>{tracking.outstandingTasks}</strong><p className={tracking.overdueTasks > 0 ? "is-overdue" : ""}>{tracking.overdueTasks} overdue</p></article>
    </section>
    <WidgetBoundary name="missing-assets"><MissingAssetsAlert eventId={overview.event.id} missing={tracking.missingAssets} /></WidgetBoundary>
    <div className="dashboard-speaker-grid">
      <WidgetBoundary name="top-speakers"><TopSpeakersList eventId={overview.event.id} rows={tracking.topByOutstanding} /></WidgetBoundary>
      <WidgetBoundary name="confirmation-mix"><ConfirmationMix mix={tracking.confirmationMix} /></WidgetBoundary>
      <WidgetBoundary name="overdue"><OverdueList eventId={overview.event.id} timezone={overview.event.timezone} rows={tracking.overdue} /></WidgetBoundary>
    </div>
  </div>;
}
