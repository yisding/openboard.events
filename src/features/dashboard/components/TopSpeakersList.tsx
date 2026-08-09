import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import type { DashboardOverview } from "../index";

export function TopSpeakersList({ eventId, rows }: { eventId: string; rows: DashboardOverview["speakerTracking"]["topByOutstanding"] }) {
  if (rows.length === 0) return <DashboardEmpty icon={<ClipboardCheck size={22} />} title="No outstanding tasks" hint="Assign tasks in Portal → Tasks." />;
  const max = Math.max(...rows.map((row) => row.openCount), 1);
  return <section className="dashboard-widget dashboard-top-speakers">
    <WidgetTitle title="Top speakers by outstanding tasks" hint="Open assignments from the canonical task view" />
    <ol>{rows.map((row, index) => <li key={row.contactId}>
      <span className="dashboard-rank">{index + 1}</span>
      <Link href={`/events/${eventId}/speakers/${row.contactId}`}><b>{row.name}</b><span>{row.overdueCount > 0 ? `${row.overdueCount} overdue` : "On time"}</span></Link>
      <div className="dashboard-bar" aria-hidden="true"><i style={{ width: `${(row.openCount / max) * 100}%` }} /></div>
      <strong>{row.openCount}</strong>
    </li>)}</ol>
  </section>;
}

export function WidgetTitle({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return <header className="dashboard-widget-title"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div>{action}</header>;
}

export function DashboardEmpty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return <section className="dashboard-widget dashboard-empty"><span>{icon}</span><h2>{title}</h2><p>{hint}</p></section>;
}
