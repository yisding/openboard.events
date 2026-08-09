import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getMySubmission, requirePortalContext } from "@/features/portal";
import { SubmissionDetail } from "@/features/portal/components/submissions-view/submission-detail";
import { FocusRefresh } from "@/features/portal/components/submissions-view/focus-refresh.client";

export const metadata: Metadata = { title: "Submission" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ eventSlug: string; submissionId: string }> }) {
  const { eventSlug, submissionId } = await params;
  // A crawler asking for /submissions/not-a-uuid would otherwise reach Postgres
  // and come back as a 22P02 error, i.e. a 500 where a 404 is the honest answer.
  if (!z.uuid().safeParse(submissionId).success) notFound();
  const { event, contact } = await requirePortalContext(eventSlug);
  const submission = await getMySubmission(event.id, contact.id, submissionId);
  // getMySubmission already returns null for a submission this contact is not on,
  // so "not yours" and "does not exist" are the same 404 to anyone probing ids.
  if (!submission) notFound();
  return (
    <div className="portal-container portal-page">
      <FocusRefresh />
      <SubmissionDetail submission={submission} eventSlug={event.slug} timezone={event.timezone} />
    </div>
  );
}
