import Link from "next/link";
import { FileText } from "lucide-react";
import type { PortalSubmissionRow } from "@/features/portal";
import { TzTime } from "@/shared/ui/app/tz-time";
import { EmptyState, StatusBadge } from "@/shared/ui/ui-kit";

/**
 * The speaker's own proposals, rendered from the database rather than from
 * browser state. Statuses arrive already collapsed — the portal never shows a
 * queue state, so "Pending" here covers a proposal that is quietly in the accept
 * queue, which is the point.
 */
export function SubmissionList({
  rows,
  eventSlug,
  timezone,
}: {
  rows: PortalSubmissionRow[];
  eventSlug: string;
  timezone: string;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<FileText size={20} />}
        title="No proposals yet"
        description="Anything you submit through a call for speakers shows up here, along with its status."
      />
    );
  }

  return (
    <div className="portal-submission-grid">
      {rows.map((row) => (
        <article className="portal-submission" key={row.submissionId}>
          <header>
            <span className="submission-code">SESS-{row.code}</span>
            <StatusBadge value={row.status} />
          </header>
          <h2>
            <Link href={`/portal/${encodeURIComponent(eventSlug)}/submissions/${row.submissionId}`}>{row.title}</Link>
          </h2>
          <footer>
            {row.submittedAt
              ? <span>Submitted <TzTime instant={row.submittedAt} tz={timezone} style="date" /></span>
              : <span>Draft — not submitted yet</span>}
            {!row.isPrimary && <span className="portal-submission__role">You are a co-speaker</span>}
          </footer>
        </article>
      ))}
    </div>
  );
}
