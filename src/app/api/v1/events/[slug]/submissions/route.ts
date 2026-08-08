import { initialDemoState } from "@/shared/demo/seed";
import { authorize, notFoundResponse, privateData, resolveEvent } from "../../../_lib";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!authorize(request)) return Response.json({ error: { code: "UNAUTHORIZED", message: "A valid API key is required" } }, { status: 401 });
  const { slug } = await params;
  const event = resolveEvent(slug);
  if (!event) return notFoundResponse();
  const submissions = initialDemoState.submissions.filter((item) => item.eventId === event.id);
  return privateData(submissions, { count: submissions.length });
}
