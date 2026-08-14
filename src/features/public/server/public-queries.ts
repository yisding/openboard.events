import { eq, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { events } from "@/db/schema";
import {
  publishedScheduleDtoSchema,
  publishedSpeakersDtoSchema,
  type PublishedScheduleDTO,
  type PublishedSpeakersDTO,
} from "@/shared/contracts";
import { DEFAULT_BRAND_COLOR } from "@/shared/lib/brand-color";
import { eventDayKey } from "@/shared/lib/time";

/**
 * The public schedule and speaker gallery's only reads. Every row comes from
 * `published_sessions_v` / `published_speakers_v` — the draft-leak firewall
 * lives in those views (status='published', starts_at set; confirmation_status
 * ='confirmed' joined to a published session), not here. The one raw-table
 * touch, `session_speakers`, is the bridge described in the M32 work order: it
 * is only ever joined against ids that already came out of a trusted view in
 * the same query, so it cannot surface a draft session's speaker or an
 * unconfirmed speaker's identity even though the junction table itself carries
 * no status column to filter on.
 *
 * Do not add a second read path here that touches `sessions` or `contacts`
 * directly — if a future surface needs a column the views don't expose, widen
 * the view (M03) instead of bypassing it.
 */

type PublicEventRow = {
  id: string;
  name: string;
  timezone: string;
  startsAt: Date;
  endsAt: Date;
  theme: string | null;
  logoFileId: string | null;
  backgroundFileId: string | null;
};

async function resolveEventBySlug(dbOrTx: DbOrTx, eventSlug: string): Promise<PublicEventRow | null> {
  const [row] = await dbOrTx
    .select({
      id: events.id,
      name: events.name,
      timezone: events.timezone,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      theme: events.theme,
      logoFileId: events.logoFileId,
      backgroundFileId: events.backgroundFileId,
    })
    .from(events)
    .where(eq(events.slug, eventSlug))
    .limit(1);
  return row ?? null;
}

function headshotUrl(fileId: string | null): string | null {
  // Immutable-cached, unsigned — M07's /f/[fileId] route is the public serving
  // path for every published headshot.
  return fileId ? `/f/${fileId}` : null;
}

function speakerName(firstName: string, lastName: string): string {
  const name = `${firstName} ${lastName}`.trim();
  return name.length > 0 ? name : "Unnamed speaker";
}

type ScheduleSessionRow = {
  id: string;
  schedule_revision: number;
  slug: string;
  title: string;
  description_html: string | null;
  starts_at: string;
  ends_at: string;
  track_id: string | null;
  track_name: string | null;
  track_color: string | null;
  room_id: string | null;
  room_name: string | null;
  format_id: string | null;
  format_name: string | null;
  speakers: Array<{ contactId: string; name: string; jobTitle: string | null; company: string | null; headshotFileId: string | null }> | null;
};

/**
 * `getPublishedSchedule` — see M32 work order Step 2. `null` means an unknown
 * or deleted slug; the caller renders `notFound()`, never a crash.
 */
export async function getPublishedScheduleIn(dbOrTx: DbOrTx, eventSlug: string): Promise<PublishedScheduleDTO | null> {
  const event = await resolveEventBySlug(dbOrTx, eventSlug);
  if (!event) return null;

  const result = await dbOrTx.execute<ScheduleSessionRow>(sql`
    SELECT v.id, v.schedule_revision, v.slug, v.title, v.description_html,
           v.starts_at, COALESCE(v.ends_at, v.starts_at) AS ends_at,
           v.track_id, v.track_name, v.track_color,
           v.room_id, v.room_name,
           v.format_id, v.format_name,
           COALESCE(spk.speakers, '[]'::json) AS speakers
    FROM published_sessions_v v
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'contactId', p.contact_id,
        'name', coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Unnamed speaker'),
        'jobTitle', p.job_title,
        'company', p.company,
        'headshotFileId', p.headshot_file_id
      ) ORDER BY ss.sort_order, p.first_name, p.last_name) AS speakers
      -- Both sides of this bridge are already leak-filtered: ss.session_id is
      -- scoped to the one published session in the outer row (v.id), and the
      -- join target is published_speakers_v, not contacts — an unconfirmed
      -- speaker on this exact session simply has no matching row here.
      FROM session_speakers ss
      JOIN published_speakers_v p ON p.contact_id = ss.contact_id AND p.event_id = ss.event_id
      WHERE ss.session_id = v.id AND ss.event_id = v.event_id
    ) spk ON true
    WHERE v.event_id = ${event.id}
    ORDER BY v.starts_at, v.id
  `);

  const sessions = (result.rows ?? []).map((row) => ({
    id: row.id,
    scheduleRevision: Number(row.schedule_revision),
    slug: row.slug,
    title: row.title,
    descriptionHtml: row.description_html,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    dayKey: eventDayKey(row.starts_at, event.timezone),
    track: row.track_id ? { id: row.track_id, name: row.track_name ?? "", color: row.track_color ?? DEFAULT_BRAND_COLOR } : null,
    room: row.room_id ? { id: row.room_id, name: row.room_name ?? "" } : null,
    format: row.format_id ? { id: row.format_id, name: row.format_name ?? "" } : null,
    speakers: (row.speakers ?? []).map((speaker) => ({
      contactId: speaker.contactId,
      name: speaker.name,
      jobTitle: speaker.jobTitle,
      company: speaker.company,
      headshotUrl: headshotUrl(speaker.headshotFileId),
    })),
  }));

  const days = [...new Set(sessions.map((session) => session.dayKey))].sort();

  return publishedScheduleDtoSchema.parse({
    event: {
      name: event.name,
      timezone: event.timezone,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      accentColor: event.theme ?? null,
      logoUrl: event.logoFileId ? `/f/${event.logoFileId}` : null,
      backgroundUrl: event.backgroundFileId ? `/f/${event.backgroundFileId}` : null,
    },
    days,
    sessions,
  });
}

export function getPublishedSchedule(eventSlug: string): Promise<PublishedScheduleDTO | null> {
  return getPublishedScheduleIn(db, eventSlug);
}

type SpeakerRow = {
  contact_id: string;
  first_name: string;
  last_name: string;
  job_title: string | null;
  company: string | null;
  bio_html: string | null;
  headshot_file_id: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  website_url: string | null;
  sessions: Array<{
    id: string; slug: string; title: string; startsAt: string; endsAt: string;
    roomId: string | null; roomName: string | null;
    trackId: string | null; trackName: string | null; trackColor: string | null;
    formatId: string | null; formatName: string | null;
  }> | null;
};

/**
 * `getPublishedSpeakers` — see M32 work order Step 3. `published_speakers_v`
 * already filters to `confirmation_status='confirmed'` speakers on at least
 * one published session, so an admin-declined speaker never reaches this
 * function's result set even when they remain on a published session row.
 */
export async function getPublishedSpeakersIn(dbOrTx: DbOrTx, eventSlug: string): Promise<PublishedSpeakersDTO | null> {
  const event = await resolveEventBySlug(dbOrTx, eventSlug);
  if (!event) return null;

  const result = await dbOrTx.execute<SpeakerRow>(sql`
    SELECT p.contact_id, p.first_name, p.last_name, p.job_title, p.company, p.bio_html, p.headshot_file_id,
           p.linkedin_url, p.twitter_url, p.website_url,
           COALESCE(sess.sessions, '[]'::json) AS sessions
    FROM published_speakers_v p
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'id', v.id, 'slug', v.slug, 'title', v.title,
        'startsAt', v.starts_at, 'endsAt', coalesce(v.ends_at, v.starts_at),
        'roomId', v.room_id, 'roomName', v.room_name,
        'trackId', v.track_id, 'trackName', v.track_name, 'trackColor', v.track_color,
        'formatId', v.format_id, 'formatName', v.format_name
      ) ORDER BY v.starts_at) AS sessions
      FROM session_speakers ss
      JOIN published_sessions_v v ON v.id = ss.session_id AND v.event_id = ss.event_id
      WHERE ss.contact_id = p.contact_id AND ss.event_id = p.event_id
    ) sess ON true
    WHERE p.event_id = ${event.id}
    ORDER BY p.last_name, p.first_name, p.contact_id
  `);

  const speakers = (result.rows ?? []).map((row) => ({
    contactId: row.contact_id,
    name: speakerName(row.first_name, row.last_name),
    jobTitle: row.job_title,
    company: row.company,
    bioHtml: row.bio_html,
    headshotUrl: headshotUrl(row.headshot_file_id),
    linkedinUrl: row.linkedin_url,
    twitterUrl: row.twitter_url,
    websiteUrl: row.website_url,
    sessions: (row.sessions ?? []).map((session) => ({
      id: session.id,
      slug: session.slug,
      title: session.title,
      startsAt: new Date(session.startsAt).toISOString(),
      endsAt: new Date(session.endsAt).toISOString(),
      dayKey: eventDayKey(session.startsAt, event.timezone),
      room: session.roomId ? { id: session.roomId, name: session.roomName ?? "" } : null,
      track: session.trackId ? { id: session.trackId, name: session.trackName ?? "", color: session.trackColor ?? DEFAULT_BRAND_COLOR } : null,
      format: session.formatId ? { id: session.formatId, name: session.formatName ?? "" } : null,
    })),
  }));

  return publishedSpeakersDtoSchema.parse({
    event: {
      name: event.name,
      timezone: event.timezone,
      accentColor: event.theme ?? null,
      logoUrl: event.logoFileId ? `/f/${event.logoFileId}` : null,
      backgroundUrl: event.backgroundFileId ? `/f/${event.backgroundFileId}` : null,
    },
    speakers,
  });
}

export function getPublishedSpeakers(eventSlug: string): Promise<PublishedSpeakersDTO | null> {
  return getPublishedSpeakersIn(db, eventSlug);
}
