import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getMySubmission, requirePortalContext } from "@/features/portal";
// M41: the same gate the edit page re-checks, reused here only to decide
// whether the Edit CTA is offered — never to render its snapshot or answers.
import { getEditableSubmission } from "@/features/portal/submissions-edit/server/queries";
import { SubmissionDetail } from "@/features/portal/components/submissions-view/submission-detail";
import { FocusRefresh } from "@/features/portal/components/submissions-view/focus-refresh.client";

export const metadata: Metadata = { title: "Submission" };
export const dynamic = "force-dynamic";

/** M41's plain-language notice after a bounce back from a blocked `/edit` visit. */
function noticeCopy(notice: string | undefined): string | null {
  // NOT_EDITABLE and NOT_FOUND collapse to one message before they ever reach
  // here — distinguishing "not yours" from "not editable" in the query string
  // would leak ownership information to whoever is probing the link.
  return notice === "edit-unavailable" ? "That submission isn’t open for editing right now." : null;
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ eventSlug: string; submissionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { eventSlug, submissionId } = await params;
  // A crawler asking for /submissions/not-a-uuid would otherwise reach Postgres
  // and come back as a 22P02 error, i.e. a 500 where a 404 is the honest answer.
  if (!z.uuid().safeParse(submissionId).success) notFound();
  const { event, contact } = await requirePortalContext(eventSlug);
  const [submission, editable, query] = await Promise.all([
    getMySubmission(event.id, contact.id, submissionId),
    getEditableSubmission(event.id, contact.id, submissionId),
    searchParams,
  ]);
  // getMySubmission already returns null for a submission this contact is not on,
  // so "not yours" and "does not exist" are the same 404 to anyone probing ids.
  if (!submission) notFound();
  const notice = noticeCopy(typeof query.notice === "string" ? query.notice : undefined);
  return (
    <div className="portal-container portal-page">
      <FocusRefresh />
      {notice && <p className="portal-note" role="status">{notice}</p>}
      <SubmissionDetail
        submission={submission}
        eventId={event.id}
        eventSlug={event.slug}
        timezone={event.timezone}
        editable={!("blocked" in editable)}
      />
    </div>
  );
}
