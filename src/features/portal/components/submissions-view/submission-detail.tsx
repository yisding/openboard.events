import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { PortalSubmissionDetail } from "@/features/portal";
import { ColorChip } from "@/shared/ui/app/color-chip";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { TzTime } from "@/shared/ui/app/tz-time";
import { StatusBadge } from "@/shared/ui/ui-kit";
import { PORTAL_STATUS_BADGES } from "@/shared/ui/status-badge";
import { participantRoleChipLabel } from "../../lib/participant-role";
import { WithdrawSubmissionButton } from "./withdraw-submission-button";

/**
 * The statuses `withdraw` will accept, in the portal's own vocabulary. "Pending"
 * covers the two queue states the speaker never sees; "Declined" is absent on
 * purpose — the transition matrix has no `declined→withdrawn` edge.
 */
const WITHDRAWABLE: ReadonlySet<PortalSubmissionDetail["status"]> = new Set(["Draft", "Pending", "Accepted"]);

/**
 * Read-only, plus an Edit entry point M41 adds: offered only when the caller's
 * own `getEditableSubmission` gate already passed (open form, pending/draft
 * status, the submitter — never a secondary participant). A speaker who needs a change
 * outside that window asks the organizers, which is what the fallback copy says
 * rather than showing a control that does nothing.
 *
 * Withdrawal is the one status change the portal may cause besides submitting a
 * draft, and this is where it lives — the same screen the speaker is looking at
 * when they decide to pull the proposal.
 */
export function SubmissionDetail({
  submission,
  eventId,
  eventSlug,
  timezone,
  editable = false,
}: {
  submission: PortalSubmissionDetail;
  eventId: string;
  eventSlug: string;
  timezone: string;
  /** M41: true only when `getEditableSubmission` did not return a blocked result. */
  editable?: boolean;
}) {
  const withdrawable = submission.isSubmitter && WITHDRAWABLE.has(submission.status);
  return (
    <article className="portal-submission-detail">
      <Link className="portal-back" href={`/portal/${encodeURIComponent(eventSlug)}/submissions`}>
        <ArrowLeft size={14} /> All submissions
      </Link>
      <header>
        <span className="submission-code">SESS-{submission.code}</span>
        <StatusBadge value={PORTAL_STATUS_BADGES[submission.status]} />
        <h1>{submission.title}</h1>
        <div className="portal-submission__vocab">
          {submission.trackName && <ColorChip label={submission.trackName} />}
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
              <em>{participant.isPrimary ? "Primary speaker" : participantRoleChipLabel(participant.role)}</em>
            </li>
          ))}
        </ul>
      </section>

      <footer className="portal-submission-actions">
        {editable ? (
          <Link className="button button-primary" href={`/portal/${encodeURIComponent(eventSlug)}/submissions/${encodeURIComponent(submission.submissionId)}/edit`}>
            Edit your submission
          </Link>
        ) : (
          <p className="portal-note">
            Need a change? Reply to any message from the organizers — submissions are read-only here.
          </p>
        )}
        {withdrawable && <WithdrawSubmissionButton eventId={eventId} submissionId={submission.submissionId} title={submission.title} />}
      </footer>
    </article>
  );
}
