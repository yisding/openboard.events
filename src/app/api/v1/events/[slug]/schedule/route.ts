import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { initialDemoState } from "@/shared/demo/seed";
import { isCredentialFreeLocalDemo } from "@/shared/lib/env";
import { corsPreflight, data, notFoundResponse, resolvePublicEvent } from "../../../_lib";

export const dynamic = "force-dynamic";

export function OPTIONS() { return corsPreflight(); }

/**
 * The published schedule, read from `published_sessions_v` — the same view the
 * public pages render. One source means the API and the page cannot disagree
 * about what is published, which is the failure this endpoint would otherwise
 * introduce.
 *
 * Speakers are mapped to an explicit DTO: no email, no confirmation state, no
 * profile-completion internals. A public endpoint leaks by listing columns, not
 * by intent.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await resolvePublicEvent(slug);
  if (!event) return notFoundResponse();

  if (isCredentialFreeLocalDemo()) {
    const sessions = initialDemoState.sessions
      .filter((item) => item.eventId === event.id && item.status === "published" && item.startsAt)
      .map((session) => ({
        ...session,
        speakers: session.speakerIds
          .map((id) => initialDemoState.speakers.find((speaker) => speaker.id === id))
          .filter((speaker) => speaker !== undefined)
          .map((speaker) => ({ id: speaker.id, firstName: speaker.firstName, lastName: speaker.lastName, company: speaker.company, title: speaker.title })),
      }));
    return data(sessions, { count: sessions.length });
  }

  const rows = await db.execute<{
    id: string; title: string; description_html: string | null; starts_at: string; ends_at: string | null;
    track_name: string | null; track_color: string | null; room_name: string | null; format_name: string | null;
    speakers: Array<{ id: string; firstName: string; lastName: string; company: string | null; title: string | null }> | null;
  }>(sql`
    SELECT v.id, v.title, v.description_html, v.starts_at, v.ends_at,
           v.track_name, v.track_color, v.room_name, v.format_name,
           COALESCE((
             SELECT json_agg(json_build_object(
               'id', c.id, 'firstName', c.first_name, 'lastName', c.last_name,
               'company', c.company, 'title', c.job_title
             ) ORDER BY ss.sort_order)
             FROM session_speakers ss
             JOIN contacts c ON c.id = ss.contact_id AND c.event_id = ss.event_id
             WHERE ss.session_id = v.id AND ss.event_id = v.event_id
           ), '[]'::json) AS speakers
    FROM published_sessions_v v
    WHERE v.event_id = ${event.id}
    ORDER BY v.starts_at
  `);

  const sessions = (rows.rows ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    descriptionHtml: row.description_html,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    track: row.track_name,
    trackColor: row.track_color,
    room: row.room_name,
    format: row.format_name,
    speakers: row.speakers ?? [],
  }));
  return data(sessions, { count: sessions.length, event: { slug: event.slug, name: event.name, timezone: event.timezone } });
}
