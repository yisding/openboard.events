import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { StatusBadge } from "@/shared/ui/ui-kit";
import { daysToEvent } from "@/shared/lib/time";
import type { DashboardOverview } from "../index";
import { DashboardEmpty, WidgetTitle } from "./TopSpeakersList";

function closesLabel(closesAt: string | null, timezone: string): string {
  if (!closesAt) return "No closing date";
  const days = daysToEvent(new Date(), new Date(closesAt), timezone);
  if (days < 0) return "Closed";
  if (days === 0) return "Closes today";
  if (days === 1) return "Closes tomorrow";
  return `Closes in ${days} days`;
}

export function FormProgressCards({ eventId, timezone, forms }: { eventId: string; timezone: string; forms: DashboardOverview["forms"] }) {
  if (forms.length === 0) return <DashboardEmpty icon={<FilePlus2 size={22} />} title="No submission forms yet" hint="Create one in Program → Forms." />;
  return <section className="dashboard-widget dashboard-form-progress">
    <WidgetTitle title="Form progress" hint="Submitted totals exclude drafts" action={<Link href={`/events/${eventId}/forms`}>View all</Link>} />
    <div>{forms.map((form) => <article key={form.formId}>
      <header><div><b>{form.name}</b><span>{closesLabel(form.closesAt, timezone)}</span></div><StatusBadge value={form.status} /></header>
      <dl><div><dt>Submitted</dt><dd>{form.submitted}</dd></div><div><dt>Drafts</dt><dd>{form.drafts}</dd></div></dl>
      <footer><Link className="button button-secondary button-sm" href={`/submit/${eventId}/${form.formId}`}>View</Link><Link className="button button-primary button-sm" href={`/events/${eventId}/forms/${form.formId}`}>Manage</Link></footer>
    </article>)}</div>
  </section>;
}
