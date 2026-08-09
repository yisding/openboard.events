import { DEMO_CAL_TOKENS, initialDemoState } from "@/shared/demo/seed";
import { buildFeed } from "@/features/comms/ics";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // The token is the credential: it must resolve to a known contact, and the
  // feed contains only that contact's sessions.
  const speakerId = DEMO_CAL_TOKENS[token];
  const speaker = speakerId ? initialDemoState.speakers.find((item) => item.id === speakerId) : undefined;
  if (!speaker) return Response.json({ error: { code: "NOT_FOUND", message: "Unknown calendar token" } }, { status: 404 });
  const sessions = initialDemoState.sessions.filter((item) => item.eventId === speaker.eventId && item.speakerIds.includes(speaker.id) && item.startsAt && item.endsAt);
  const body = buildFeed("My AI Engineer sessions", sessions.map((session) => {
    if (!session.startsAt || !session.endsAt) throw new Error("scheduled session is missing dates");
    return {
      uid: `${session.id}@openboard`,
      sequence: 1,
      method: null,
      startsAt: new Date(session.startsAt),
      endsAt: new Date(session.endsAt),
      dtstamp: new Date(session.startsAt),
      summary: session.title,
      description: session.description,
      location: session.room,
      url: new URL(`/e/ai-engineer/schedule?session=${session.id}`, request.url).toString(),
      organizer: { name: "AI Engineer", email: "speakers@ai.engineer" },
    };
  }));
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": "inline; filename=ai-engineer-sessions.ics", "cache-control": "private, no-store" } });
}
