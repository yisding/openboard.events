import type { DashboardOverview } from "../index";
import { WidgetTitle } from "./TopSpeakersList";

export function StatusRow({ counts }: { counts: DashboardOverview["statusCounts"] }) {
  const items = [
    { label: "Accepted", count: counts.accepted + counts.accept_queue, title: "Accepted includes the accept queue." },
    { label: "Pending", count: counts.pending, title: "Submitted and awaiting a decision." },
    { label: "Declined", count: counts.declined + counts.decline_queue, title: "Declined includes the decline queue." },
    { label: "Drafts", count: counts.draft, title: "Drafts are excluded from the Submissions KPI." },
    { label: "Withdrawn", count: counts.withdrawn, title: "Withdrawn submissions remain in status totals." },
  ];
  return <section className="dashboard-widget dashboard-statuses">
    <WidgetTitle title="Submission status" hint="Queue states are folded into their decision tiles" />
    <div>{items.map((item) => <article key={item.label} title={item.title}><strong>{item.count}</strong><span>{item.label}</span></article>)}</div>
  </section>;
}
