import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { SavedFormActions } from "@/features/forms/components/saved-form-actions";
import { StatusBadge } from "@/shared/ui/ui-kit";
import { daysToEvent, formatInZone } from "@/shared/lib/time";
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

function availabilityLabel(form: DashboardOverview["forms"][number], timezone: string): string {
  switch (form.availability) {
    case "draft":
      return "Not published";
    case "scheduled":
      return form.opensAt ? `Opens ${formatInZone(form.opensAt, timezone, "date")}` : "Scheduled to open";
    case "live":
      return closesLabel(form.closesAt, timezone);
    case "ended":
      return form.closesAt ? `Ended ${formatInZone(form.closesAt, timezone, "date")}` : "Submission window ended";
    case "closed":
      return "Closed manually";
  }
}

export function FormProgressCards({ eventId, eventSlug, timezone, forms }: { eventId: string; eventSlug: string; timezone: string; forms: DashboardOverview["forms"] }) {
  if (forms.length === 0) return <DashboardEmpty icon={<FilePlus2 size={22} />} title="No submission forms yet" hint="Create one in Program → Forms." />;
  return <section className="dashboard-widget dashboard-form-progress">
    <WidgetTitle title="Form progress" hint="Submitted totals exclude drafts" action={<Link href={`/events/${eventId}/forms`}>View all</Link>} />
    <div>{forms.map((form) => <article key={form.formId}>
      <header><div><b>{form.name}</b><span>{availabilityLabel(form, timezone)}</span></div><StatusBadge value={form.availability} /></header>
      <dl><div><dt>Submitted</dt><dd>{form.submitted}</dd></div><div><dt>Drafts</dt><dd>{form.drafts}</dd></div></dl>
      <footer>
        <SavedFormActions
          availability={form.availability}
          eventSlug={eventSlug}
          formId={form.formId}
          formName={form.name}
          previewHref={`/events/${eventId}/forms/${form.formId}/preview`}
          compact
        />
        <Link className="button button-primary button-sm" href={`/events/${eventId}/forms/${form.formId}`}>Manage</Link>
      </footer>
    </article>)}</div>
  </section>;
}
