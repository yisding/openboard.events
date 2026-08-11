import { SignJWT, jwtVerify } from "jose";
import { sql, type SQLWrapper } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { contactIdSchema, eventIdSchema, type ContactId, type EventId } from "@/shared/contracts";
import { getEnv } from "@/shared/lib/env";
import { AppError } from "@/shared/lib/errors";

// A plain, non-generic `execute` — matching `shell/server/nav-counts.ts`'s
// `NavCountsDb` — rather than the app's concrete `DbOrTx` (Neon-only): the
// latter's generic `execute<T>` does not structurally match
// `drizzle-orm/pglite`'s, which is what this module's own PGlite test passes.
export type ShareDb = {
  execute(query: SQLWrapper | string): PromiseLike<{ rows: Record<string, unknown>[] }>;
};

/**
 * M59 — the "I'm speaking!" share page. A stateless signed token (same shape
 * as `comms/server/unsubscribe.ts`'s), not a `portal_tokens` row: there is
 * nothing here to *consume* — a speaker shares this link expecting it to keep
 * working, not to expire the moment someone else opens it — and a token
 * purpose is a schema enum value, which this avoids adding.
 */
const ISSUER = "openboard";
const AUDIENCE = "openboard:speaker-share";
const shareClaimsSchema = z.object({
  purpose: z.literal("speaker_share"),
  eventId: eventIdSchema,
  contactId: contactIdSchema,
});
type ShareClaims = z.infer<typeof shareClaimsSchema>;

function configuredSecret(): string {
  const secret = getEnv().SPEAKER_SHARE_SECRET;
  if (!secret) throw new AppError("INTERNAL", "SPEAKER_SHARE_SECRET is required for speaker share links");
  return secret;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signSpeakerShareToken(
  claims: { eventId: EventId; contactId: ContactId },
  secret = configuredSecret(),
): Promise<string> {
  return new SignJWT({ ...claims, purpose: "speaker_share" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    // Long-lived on purpose — a talk announcement tweet from six months ago
    // should not 404 the week before the event.
    .setExpirationTime("2y")
    .sign(secretKey(secret));
}

export async function verifySpeakerShareToken(token: string, secret = configuredSecret()): Promise<ShareClaims | null> {
  try {
    const verified = await jwtVerify(token, secretKey(secret), {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return shareClaimsSchema.parse(verified.payload);
  } catch {
    return null;
  }
}

export type SpeakerShareDTO = {
  eventName: string;
  eventSlug: string;
  eventTimezone: string;
  speakerName: string;
  headshotUrl: string | null;
  submissionCode: number;
  submissionTitle: string;
  /** Present only once the session has an assigned, *published* schedule slot — never before. */
  schedule: { startsAt: string; endsAt: string; roomName: string | null } | null;
};

type ShareRow = {
  first_name: string;
  last_name: string;
  email: string;
  headshot_file_id: string | null;
  submission_code: number;
  submission_title: string;
  event_name: string;
  event_slug: string;
  event_timezone: string;
  session_status: string | null;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  room_name: string | null;
};

function displayName(first: string, last: string, email: string): string {
  const name = `${first} ${last}`.trim();
  return name.length > 0 ? name : email;
}

function iso(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Deliberately reads `submissions`/`contacts` directly, never
 * `published_speakers_v` — that view joins through a scheduled *and
 * published* session and has no row at accept time, which is exactly when
 * this page needs to exist (experience-design.md's "Speakers" catalog entry).
 * Schedule details are the one thing gated on publication: `session_status`
 * has to read `'published'` before `schedule` is populated, even though the
 * session row itself may already carry times an organizer is still drafting.
 */
export async function getSpeakerShareDataIn(dbOrTx: ShareDb, eventId: EventId, contactId: ContactId): Promise<SpeakerShareDTO | null> {
  const result = await dbOrTx.execute(sql`
    SELECT
      c.first_name, c.last_name, c.email, c.headshot_file_id,
      s.code AS submission_code, s.title AS submission_title,
      e.name AS event_name, e.slug AS event_slug, e.timezone AS event_timezone,
      sess.status AS session_status, sess.starts_at, sess.ends_at, r.name AS room_name
    FROM submissions s
    JOIN submission_participants sp ON sp.submission_id = s.id AND sp.event_id = s.event_id
    JOIN contacts c ON c.id = sp.contact_id AND c.event_id = s.event_id
    JOIN events e ON e.id = s.event_id
    LEFT JOIN sessions sess ON sess.submission_id = s.id AND sess.event_id = s.event_id
    LEFT JOIN rooms r ON r.id = sess.room_id AND r.event_id = sess.event_id
    WHERE s.event_id = ${eventId} AND sp.contact_id = ${contactId} AND s.status = 'accepted'
    ORDER BY s.code ASC
    LIMIT 1
  `);
  const row = result.rows[0] as ShareRow | undefined;
  if (!row) return null;
  const startsAt = iso(row.starts_at);
  const endsAt = iso(row.ends_at);
  return {
    eventName: row.event_name,
    eventSlug: row.event_slug,
    eventTimezone: row.event_timezone,
    speakerName: displayName(row.first_name, row.last_name, row.email),
    headshotUrl: row.headshot_file_id ? `/f/${row.headshot_file_id}` : null,
    submissionCode: row.submission_code,
    submissionTitle: row.submission_title,
    schedule: row.session_status === "published" && startsAt && endsAt
      ? { startsAt, endsAt, roomName: row.room_name }
      : null,
  };
}

export const getSpeakerShareData = (eventId: EventId, contactId: ContactId) => getSpeakerShareDataIn(db, eventId, contactId);
