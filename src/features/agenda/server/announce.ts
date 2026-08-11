import { sql, type SQLWrapper } from "drizzle-orm";
import { db } from "@/db/client";
import { signSpeakerShareToken } from "@/features/portal/server/share";
import { contactIdSchema, eventIdSchema, type EventId } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";
import { formatInZone } from "@/shared/lib/time";

/**
 * M60 — "The 'ready to announce' bundle... Packaging over proven surfaces"
 * (experience-design.md). Every field here is either a URL built from
 * `slug`, a per-speaker token minted through M59's existing signer, or copy
 * templated from data the dashboard already reads — no new publish state,
 * no new schema. `hasPublishedSchedule` is what a caller gates the whole
 * panel on: assembling this before anything is public would hand an
 * organizer a bundle of broken links.
 */
export type AnnounceSpeakerLink = { contactId: string; name: string; shareUrl: string | null };

export type AnnounceBundle = {
  hasPublishedSchedule: boolean;
  publicUrls: { agenda: string; sessions: string; speakers: string; gallery: string; itinerary: string };
  embedSnippet: string;
  speakerLinks: AnnounceSpeakerLink[];
  announcementCopy: string;
};

type AnnounceDb = {
  execute(query: SQLWrapper | string): PromiseLike<{ rows: Record<string, unknown>[] }>;
};

type EventRow = { name: string; slug: string; timezone: string; starts_at: string | Date };
type SpeakerRow = { contact_id: string; first_name: string; last_name: string; email: string };

function displayName(row: SpeakerRow): string {
  const name = `${row.first_name} ${row.last_name}`.trim();
  return name.length > 0 ? name : row.email;
}

export async function getAnnounceBundleIn(dbOrTx: AnnounceDb, eventId: EventId, appBaseUrl = getEnv().APP_BASE_URL): Promise<AnnounceBundle | null> {
  const eventResult = await dbOrTx.execute(sql`
    SELECT name, slug, timezone, starts_at FROM events WHERE id = ${eventId} LIMIT 1
  `);
  const event = eventResult.rows[0] as EventRow | undefined;
  if (!event) return null;

  const publishedCount = await dbOrTx.execute(sql`
    SELECT count(*)::int AS n FROM sessions WHERE event_id = ${eventId} AND status = 'published' AND starts_at IS NOT NULL
  `);
  const hasPublishedSchedule = Number((publishedCount.rows[0] as { n?: number } | undefined)?.n ?? 0) > 0;

  const base = `${appBaseUrl}/e/${event.slug}`;
  const publicUrls = {
    agenda: `${base}/agenda`,
    sessions: `${base}/sessions`,
    speakers: `${base}/speakers`,
    gallery: `${base}/gallery`,
    itinerary: `${base}/itinerary`,
  };
  const embedSnippet = `<iframe src="${appBaseUrl}/embed/${event.slug}/agenda" width="100%" height="760" style="border:0" loading="lazy" title="${event.name} agenda"></iframe>`;

  let speakerLinks: AnnounceSpeakerLink[] = [];
  if (hasPublishedSchedule) {
    const speakerRows = await dbOrTx.execute(sql`
      SELECT DISTINCT c.id AS contact_id, c.first_name, c.last_name, c.email
      FROM submissions s
      JOIN submission_participants sp ON sp.submission_id = s.id AND sp.event_id = s.event_id
      JOIN contacts c ON c.id = sp.contact_id AND c.event_id = s.event_id
      WHERE s.event_id = ${eventId} AND s.status = 'accepted'
      ORDER BY c.last_name, c.first_name
    `);
    speakerLinks = await Promise.all((speakerRows.rows as SpeakerRow[]).map(async (row) => {
      let shareUrl: string | null = null;
      try {
        const token = await signSpeakerShareToken({ eventId, contactId: contactIdSchema.parse(row.contact_id) });
        shareUrl = `${appBaseUrl}/speaking/${token}`;
      } catch {
        // SPEAKER_SHARE_SECRET not provisioned yet in this environment — the
        // rest of the bundle (URLs, embed, copy) is still useful without it.
        shareUrl = null;
      }
      return { contactId: row.contact_id, name: displayName(row), shareUrl };
    }));
  }

  const eventDate = formatInZone(event.starts_at, event.timezone, { month: "long", day: "numeric" });
  const announcementCopy = `The full schedule for ${event.name} is live! Join us ${eventDate} — see who's speaking and build your agenda: ${publicUrls.agenda}`;

  return { hasPublishedSchedule, publicUrls, embedSnippet, speakerLinks, announcementCopy };
}

export const getAnnounceBundle = (eventId: EventId) => getAnnounceBundleIn(db, eventIdSchema.parse(eventId));
