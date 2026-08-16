import Link from "next/link";
import { Inbox } from "lucide-react";
import { TzTime } from "@/shared/ui/app/tz-time";
import { StatusBadge } from "@/shared/ui/ui-kit";
import type { DashboardOverview } from "../index";
import { DashboardEmpty, WidgetTitle } from "./TopSpeakersList";

export function RecentSubmissionsTable({ eventId, timezone, rows }: { eventId: string; timezone: string; rows: DashboardOverview["recentSubmissions"] }) {
  if (rows.length === 0) return <DashboardEmpty icon={<Inbox size={22} />} title="No submissions yet" hint="Share your call for speakers link to get started." />;
  return <section className="dashboard-widget dashboard-recent">
    <WidgetTitle title="Recent submissions" hint="Newest non-draft submissions" action={<Link href={`/events/${eventId}/abstracts`}>View all</Link>} />
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Source</th><th>Title</th><th>Status</th><th>Speakers</th><th>Tags</th><th>Submitted</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}><td><span className="dashboard-recent-source">{row.source || "—"}</span><small>{row.code}</small></td><td><div className="dashboard-title-cell"><Link href={`/events/${eventId}/abstracts?submission=${encodeURIComponent(row.id)}`}><b>{row.title || "—"}</b><span className="sr-only">Open submission</span></Link></div></td><td><StatusBadge value={row.status} /></td><td>{row.speakers.length > 0 ? row.speakers.join(", ") : <span className="dash">—</span>}</td><td>{row.tags.length > 0 ? <div className="dashboard-tags">{row.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : <span className="dash">—</span>}</td><td><TzTime instant={row.submittedAt} tz={timezone} style="date" secondary="time" /></td></tr>)}</tbody>
    </table></div>
  </section>;
}
