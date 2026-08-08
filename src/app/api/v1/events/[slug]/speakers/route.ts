import { initialDemoState } from "@/shared/demo/seed";
import { data, notFoundResponse, resolveEvent } from "../../../_lib";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = resolveEvent(slug);
  if (!event) return notFoundResponse();
  const speakers = initialDemoState.speakers
    .filter((item) => item.eventId === event.id && item.confirmation === "confirmed")
    .map((item) => ({ id: item.id, eventId: item.eventId, firstName: item.firstName, lastName: item.lastName, company: item.company, title: item.title, bio: item.bio, location: item.location, website: item.website, linkedin: item.linkedin, avatar: item.avatar, tags: item.tags }));
  return data(speakers, { count: speakers.length });
}
