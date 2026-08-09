import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { PortalSubmissionDetail } from "@/features/portal";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { TzTime } from "@/shared/ui/app/tz-time";
import { StatusBadge } from "@/shared/ui/ui-kit";

/**
 * Read-only by design. Editing a submission until its form closes is M41; until
 * that lands a speaker who needs a change asks the organizers, which is what the
 * copy says rather than showing a control that does nothing.
 */
export function SubmissionDetail({
  submission,
  eventSlug,
  timezone,
}: {
  submission: PortalSubmissionDetail;
  eventSlug: string;
  timezone: string;
}) {
  return (
    <article className="portal-submission-detail">
      <Link className="portal-back" href={`/portal/${encodeURIComponent(eventSlug)}/submissions`}>
        <ArrowLeft size={14} /> All submissions
      </Link>
      <header>
        <span className="submission-code">SESS-{submission.code}</span>
        <StatusBadge value={submission.status} />
        <h1>{submission.title}</h1>
        <div className="portal-submission__vocab">
          {submission.trackName && <ColorChip label={submission.trackName} color={submission.trackColor} />}
          {submission.formatName && <span className="track-chip">{submission.formatName}</span>}
        </div>
        <p>
          {submission.submittedAt
            ? <>Submitted <TzTime instant={submission.submittedAt} tz={timezone} style="long" /></>
            : <>Not submitted yet</>}
        </p>
      </header>

      {submission.descriptionHtml && (
        <section>
          <h2 className="section-title">Description</h2>
          <RichTextView html={submission.descriptionHtml} />
        </section>
      )}

      <section>
        <h2 className="section-title">Speakers</h2>
        <ul className="portal-participants">
          {submission.participants.map((participant) => (
            <li key={participant.contactId}>
              <b>{participant.name}</b>
              <span>{participant.email}</span>
              {participant.isPrimary && <em>Primary contact</em>}
            </li>
          ))}
        </ul>
      </section>

      <p className="portal-note">
        Need a change? Reply to any message from the organizers — proposals are read-only here.
      </p>
    </article>
  );
}
