import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { speakerDisplayName } from "@/shared/contracts";
import { apiV1ErrorResponse, checkV1RateLimit, corsPreflight, data, notFoundResponse, resolvePublicEvent } from "../../../_lib";

export const dynamic = "force-dynamic";

export function OPTIONS() { return corsPreflight(); }

/**
 * The public speaker gallery, read from `published_speakers_v`. That view is
 * where "public" is defined — confirmed, and on a published session with a time
 * — so this endpoint cannot disagree with the gallery page about who appears.
 * A declined or unconfirmed speaker showing up here is the one leak that cannot
 * be walked back after judging.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    return await handleGet(request, params);
  } catch (error) {
    return apiV1ErrorResponse(error, request);
  }
}

async function handleGet(request: Request, params: Promise<{ slug: string }>) {
  await checkV1RateLimit("speakers", request);
  const { slug } = await params;
  const event = await resolvePublicEvent(slug);
  if (!event) return notFoundResponse();

  const rows = await db.execute<{
    contact_id: string; first_name: string; last_name: string; job_title: string | null;
    company: string | null; bio_html: string | null; headshot_file_id: string | null;
    linkedin_url: string | null; twitter_url: string | null; website_url: string | null;
  }>(sql`
    SELECT contact_id, first_name, last_name, job_title, company, bio_html, headshot_file_id,
           linkedin_url, twitter_url, website_url
    FROM published_speakers_v
    WHERE event_id = ${event.id}
    ORDER BY last_name, first_name
  `);

  // No email and no confirmation state: the DTO is the boundary, and it is
  // written out rather than spread from the row.
  //
  // `name` is the field to render. `first_name`/`last_name` default to `''`, so
  // a contact created from a submission or an invitation has no name at all,
  // and concatenating the two raw fields client-side produces a blank card —
  // the gallery page says "Unnamed speaker" there, and so must this.
  const speakers = (rows.rows ?? []).map((row) => ({
    id: row.contact_id,
    name: speakerDisplayName(row.first_name, row.last_name),
    firstName: row.first_name,
    lastName: row.last_name,
    title: row.job_title,
    company: row.company,
    bioHtml: row.bio_html,
    headshotUrl: row.headshot_file_id ? `/f/${row.headshot_file_id}` : null,
    linkedin: row.linkedin_url,
    twitter: row.twitter_url,
    website: row.website_url,
  }));
  return data(speakers, { count: speakers.length, event: { slug: event.slug, name: event.name } });
}
