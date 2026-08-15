import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { apiV1ErrorResponse, checkV1RateLimit, corsPreflight, data, notFoundResponse, resolvePublicEvent } from "../../../_lib";

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
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    return await handleGet(request, params);
  } catch (error) {
    return apiV1ErrorResponse(error, request);
  }
}

async function handleGet(request: Request, params: Promise<{ slug: string }>) {
  await checkV1RateLimit("schedule", request);
  const { slug } = await params;
  const event = await resolvePublicEvent(slug);
  if (!event) return notFoundResponse();

  const rows = await db.execute<{
    id: string; title: string; description_html: string | null; starts_at: string; ends_at: string | null;
    track_name: string | null; track_color: string | null; room_name: string | null; format_name: string | null;
    speakers: Array<{ id: string; firstName: string; lastName: string; company: string | null; title: string | null }> | null;
  }>(sql`
    SELECT v.id, v.title, v.description_html, v.starts_at, v.ends_at,
           v.track_name, v.track_color, v.room_name, v.format_name,
           COALESCE((
             SELECT json_agg(json_build_object(
               'id', p.contact_id, 'firstName', p.first_name, 'lastName', p.last_name,
               'company', p.company, 'title', p.job_title
             ) ORDER BY ss.sort_order)
             FROM session_speakers ss
             JOIN published_speakers_v p ON p.contact_id = ss.contact_id AND p.event_id = ss.event_id
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
