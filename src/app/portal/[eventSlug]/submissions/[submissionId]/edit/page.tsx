import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requirePortalContext } from "@/features/portal";
import { getEditableSubmission } from "@/features/portal/submissions-edit/server/queries";
import { EditSubmissionForm } from "@/features/portal/submissions-edit/components/edit-submission-form";
import { FormClosedNotice } from "@/features/portal/submissions-edit/components/form-closed-notice";

export const metadata: Metadata = { title: "Edit submission" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventSlug: string; submissionId: string }> }) {
  const { eventSlug, submissionId } = await params;
  // A crawler or a hand-typed path asking for /edit on a non-uuid otherwise
  // reaches Postgres and comes back as a 22P02 error, i.e. a 500 where a 404 is
  // the honest answer.
  if (!z.uuid().safeParse(submissionId).success) notFound();
  const { event, contact } = await requirePortalContext(eventSlug);
  const result = await getEditableSubmission(event.id, contact.id, submissionId);

  const detailHref = `/portal/${encodeURIComponent(eventSlug)}/submissions/${encodeURIComponent(submissionId)}`;

  if ("blocked" in result) {
    // FORM_CLOSED gets the friendly page M14 built for exactly this apology —
    // the deadline race between opening this page and the last one is real.
    if (result.blocked === "FORM_CLOSED") {
      return (
        <div className="portal-container portal-page">
          <FormClosedNotice detailHref={detailHref} />
        </div>
      );
    }
    // NOT_EDITABLE (decided/withdrawn/never had a form) and NOT_FOUND (not this
    // contact's submission — including a co-speaker, who is deliberately not
    // offered edit rights here) collapse to the same redirect: the read-only
    // detail page is what this contact is allowed to see either way, and
    // distinguishing the two in the query string would leak which case applied.
    redirect(`${detailHref}?notice=edit-unavailable`);
  }

  return (
    <div className="portal-container portal-page">
      <EditSubmissionForm
        eventId={event.id}
        eventSlug={event.slug}
        submissionId={submissionId}
        submission={result.submission}
        snapshot={result.snapshot}
        answers={result.answers}
      />
    </div>
  );
}
