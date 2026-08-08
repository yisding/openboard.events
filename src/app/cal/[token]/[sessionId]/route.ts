import { DEMO_CAL_TOKENS, initialDemoState } from "@/shared/demo/seed";
import { buildInvite } from "@/features/comms/ics";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string; sessionId: string }> }) {
  const { token, sessionId } = await params;
  const speakerId = DEMO_CAL_TOKENS[token];
  const speaker = speakerId ? initialDemoState.speakers.find((item) => item.id === speakerId) : undefined;
  if (!speaker) return Response.json({ error: { code: "NOT_FOUND", message: "Unknown calendar token" } }, { status: 404 });
  // The session must belong to the token's contact — any other id 404s.
  const session = initialDemoState.sessions.find((item) => item.id === sessionId && item.eventId === speaker.eventId && item.speakerIds.includes(speaker.id) && item.startsAt && item.endsAt);
  if (!session) return Response.json({ error: { code: "NOT_FOUND", message: "Session not found" } }, { status: 404 });
  const body = buildInvite({ uid: `${session.id}@openboard`, sequence: 1, startsAt: session.startsAt ?? "", endsAt: session.endsAt ?? "", summary: session.title, description: session.description, location: session.room }, "PUBLISH");
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${session.id}.ics"`, "cache-control": "private, no-store" } });
}
