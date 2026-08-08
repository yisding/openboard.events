import { authorize, notFoundResponse, privateData, resolveEvent } from "../../../_lib";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!authorize(request)) return Response.json({ error: { code: "UNAUTHORIZED", message: "A valid API key is required" } }, { status: 401 });
  const { slug } = await params;
  const event = resolveEvent(slug);
  if (!event) return notFoundResponse();
  return privateData({ submissions: 247, accepted: 82, confirmed: 78, tasksOutstanding: 18, sessionsPublished: 32 });
}
