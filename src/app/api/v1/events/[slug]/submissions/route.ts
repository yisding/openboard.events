import { SUBMISSION_STATUSES, type SubmissionStatus } from "@/shared/contracts";
import { initialDemoState } from "@/shared/demo/seed";
import { authorize, corsPreflight, notFoundResponse, privateData, resolveEvent } from "../../../_lib";

export function OPTIONS() { return corsPreflight(); }

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!authorize(request)) return Response.json({ error: { code: "UNAUTHORIZED", message: "A valid API key is required" } }, { status: 401 });
  const { slug } = await params;
  const event = resolveEvent(slug);
  if (!event) return notFoundResponse();
  const requestedStatus = new URL(request.url).searchParams.get("status");
  if (requestedStatus && !SUBMISSION_STATUSES.includes(requestedStatus as SubmissionStatus)) {
    return Response.json({ error: { code: "BAD_REQUEST", message: `Unknown status: ${requestedStatus}` } }, { status: 400 });
  }
  // Drafts are never exposed through the API, even to key holders.
  const submissions = initialDemoState.submissions.filter((item) => item.eventId === event.id && item.status !== "draft" && (!requestedStatus || item.status === requestedStatus));
  return privateData(submissions, { count: submissions.length });
}
