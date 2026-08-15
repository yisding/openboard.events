import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { TzTime } from "@/shared/ui/app/tz-time";
import type { DashboardOverview } from "../index";
import { DashboardEmpty, WidgetTitle } from "./TopSpeakersList";

export function OverdueList({ eventId, timezone, rows }: { eventId: string; timezone: string; rows: DashboardOverview["speakerTracking"]["overdue"] }) {
  if (rows.length === 0) return <DashboardEmpty icon={<CalendarCheck size={22} />} title="Nothing overdue" hint="Every assigned task is on time." />;
  return <section className="dashboard-widget dashboard-overdue">
    <WidgetTitle title="Overdue" hint="Oldest due date first" />
    <div className="dashboard-overdue-list">{rows.map((row) => <Link key={`${row.taskId}:${row.contactId}:${row.submissionCode ?? "contact"}`} href={`/events/${eventId}/speakers?contactId=${encodeURIComponent(row.contactId)}`}>
      <div><b>{row.taskName}</b><span>{row.name}</span></div>
      <span className="submission-code">{row.submissionCode ?? "—"}</span>
      <TzTime instant={row.dueAt} tz={timezone} style={{ dateStyle: "medium", timeStyle: "short" }} />
    </Link>)}</div>
  </section>;
}
