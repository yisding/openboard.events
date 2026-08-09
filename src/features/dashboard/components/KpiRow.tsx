import { CalendarCheck, FileText, UserCheck, WandSparkles } from "lucide-react";
import type { DashboardOverview } from "../index";

export function KpiRow({ kpis }: { kpis: DashboardOverview["kpis"] }) {
  const items = [
    { label: "Submissions", value: kpis.submissions, hint: "Non-draft", icon: <FileText size={19} />, tone: "purple" },
    { label: "Accepted speakers", value: kpis.acceptedSpeakers, hint: "Unique contacts", icon: <UserCheck size={19} />, tone: "green" },
    { label: "Scheduled sessions", value: kpis.scheduledSessions, hint: "Published with a time", icon: <CalendarCheck size={19} />, tone: "blue" },
    { label: "Unscheduled accepted", value: kpis.unscheduledAccepted, hint: "Need a time slot", icon: <WandSparkles size={19} />, tone: "amber" },
  ];
  return <section className="dashboard-kpi-row">{items.map((item) => <article key={item.label}>
    <span className={`metric-icon ${item.tone}`}>{item.icon}</span><div><strong>{item.value}</strong><b>{item.label}</b><small>{item.hint}</small></div>
  </article>)}</section>;
}
