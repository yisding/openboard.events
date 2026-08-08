import { initialDemoState } from "@/shared/demo/seed";
import { data, notFoundResponse, resolveEvent } from "../../../_lib";

// Speakers are mapped to the explicit public DTO — no email, confirmation
// state, or profile-completion internals on the public schedule.
function publicSpeaker(id: string) {
  const speaker = initialDemoState.speakers.find((item) => item.id === id);
  if (!speaker) return null;
  return { id: speaker.id, firstName: speaker.firstName, lastName: speaker.lastName, company: speaker.company, title: speaker.title, avatar: speaker.avatar, tags: speaker.tags };
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = resolveEvent(slug);
  if (!event) return notFoundResponse();
  const sessions = initialDemoState.sessions
    .filter((item) => item.eventId === event.id && item.status === "published" && item.startsAt)
    .map((session) => ({ ...session, speakers: session.speakerIds.map(publicSpeaker).filter(Boolean) }));
  return data(sessions, { count: sessions.length });
}
