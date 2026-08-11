import {
  publishedScheduleDtoSchema,
  publishedSpeakersDtoSchema,
  type PublishedScheduleDTO,
  type PublishedSpeakersDTO,
} from "@/shared/contracts";
import { DEMO_EVENT_SLUG, initialDemoState } from "@/shared/demo/seed";
import { eventDayKey } from "@/shared/lib/time";

function fixtureUuid(group: number, index: number): string {
  return `00000000-0000-4000-8${String(group).padStart(3, "0")}-${String(index + 1).padStart(12, "0")}`;
}

function htmlParagraph(value: string): string {
  const escaped = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return `<p>${escaped}</p>`;
}

function publicUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^https?:\/\//u.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function sessionSlug(title: string, index: number): string {
  const value = title.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  return value || `session-${index + 1}`;
}

export function demoPublishedSchedule(eventSlug: string): PublishedScheduleDTO | null {
  if (eventSlug !== DEMO_EVENT_SLUG) return null;
  const event = initialDemoState.events.find((item) => item.slug === eventSlug);
  if (!event) return null;

  const tracks = [...new Set(initialDemoState.sessions.map((session) => session.track).filter(Boolean))];
  const rooms = [...new Set(initialDemoState.sessions.map((session) => session.room).filter(Boolean))];
  const formats = [...new Set(initialDemoState.submissions.map((submission) => submission.format).filter(Boolean))];
  const sessions = initialDemoState.sessions
    .filter((session) => session.eventId === event.id && session.status === "published" && session.startsAt && session.endsAt)
    .map((session, index) => {
      const startsAt = session.startsAt;
      const endsAt = session.endsAt;
      if (!startsAt || !endsAt) throw new Error("published demo sessions require start and end times");
      const trackIndex = tracks.indexOf(session.track);
      const roomIndex = rooms.indexOf(session.room);
      const submission = initialDemoState.submissions.find((item) => item.id === session.submissionId);
      const formatIndex = submission ? formats.indexOf(submission.format) : -1;
      return {
        id: fixtureUuid(1, index),
        slug: sessionSlug(session.title, index),
        title: session.title,
        descriptionHtml: htmlParagraph(session.description),
        startsAt,
        endsAt,
        dayKey: eventDayKey(startsAt, event.timezone),
        track: trackIndex >= 0 ? { id: fixtureUuid(3, trackIndex), name: session.track, color: event.accent } : null,
        room: roomIndex >= 0 ? { id: fixtureUuid(4, roomIndex), name: session.room } : null,
        format: formatIndex >= 0 && submission
          ? { id: fixtureUuid(5, formatIndex), name: submission.format }
          : null,
        speakers: session.speakerIds.flatMap((speakerId) => {
          const speakerIndex = initialDemoState.speakers.findIndex((item) => item.id === speakerId);
          const speaker = initialDemoState.speakers[speakerIndex];
          return speaker && speaker.confirmation === "confirmed"
            ? [{
                contactId: fixtureUuid(2, speakerIndex),
                name: `${speaker.firstName} ${speaker.lastName}`,
                jobTitle: speaker.title || null,
                company: speaker.company || null,
                headshotUrl: null,
              }]
            : [];
        }),
      };
    });

  return publishedScheduleDtoSchema.parse({
    event: {
      name: event.name,
      timezone: event.timezone,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      accentColor: event.accent,
    },
    days: [...new Set(sessions.map((session) => session.dayKey))].sort(),
    sessions,
  });
}

export function demoPublishedSpeakers(eventSlug: string): PublishedSpeakersDTO | null {
  const schedule = demoPublishedSchedule(eventSlug);
  const event = initialDemoState.events.find((item) => item.slug === eventSlug);
  if (!schedule || !event) return null;

  const speakers = initialDemoState.speakers.flatMap((speaker, speakerIndex) => {
    if (speaker.confirmation !== "confirmed") return [];
    const contactId = fixtureUuid(2, speakerIndex);
    const sessions = schedule.sessions
      .filter((session) => session.speakers.some((item) => item.contactId === contactId))
      .map(({ id, slug, title, startsAt, endsAt, dayKey, room, track, format }) => ({
        id, slug, title, startsAt, endsAt, dayKey, room, track, format,
      }));
    if (sessions.length === 0) return [];
    return [{
      contactId,
      name: `${speaker.firstName} ${speaker.lastName}`,
      jobTitle: speaker.title || null,
      company: speaker.company || null,
      bioHtml: htmlParagraph(speaker.bio),
      headshotUrl: null,
      linkedinUrl: publicUrl(speaker.linkedin),
      twitterUrl: null,
      websiteUrl: publicUrl(speaker.website),
      sessions,
    }];
  });

  return publishedSpeakersDtoSchema.parse({
    event: { name: event.name, timezone: event.timezone, accentColor: event.accent },
    speakers,
  });
}
