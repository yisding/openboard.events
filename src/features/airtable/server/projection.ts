import { type SQL, sql } from "drizzle-orm";
import type { AirtableConnectionOptions } from "@/db/schema";
import type { DbOrTx } from "@/db/client";
import type { EventId } from "@/shared/contracts";
import type { SyncTableKey } from "../plan";

/**
 * Change detection lives in Postgres, not in the isolate.
 *
 * Each table's Airtable payload is built with `jsonb_build_object`, hashed with
 * `sha256` over jsonb's canonical text form, and anti-joined against
 * `airtable_sync_state`. Only genuinely-changed rows come back, already
 * projected, with `count(*) OVER ()` giving a true remainder for the "118 to
 * go" line the UI shows.
 *
 * Four properties fall out that a JS-side hash does not give:
 *
 * 1. **Denormalized values cannot desync.** A track rename changes the hashed
 *    object of every session on that track, so every one of them re-pushes.
 * 2. **The backlog is exact**, not estimated.
 * 3. **Memory and PII are both bounded** — `LIMIT` caps the batch, and the only
 *    personal data that crosses into the isolate is what is being pushed anyway.
 * 4. **The feature boundary stays green by construction.** These are raw SQL
 *    statements over `@/db/schema`, so `features/airtable` never imports
 *    `features/agenda`, `features/submissions`, or `features/event-contacts`.
 *
 * Link fields are the subtle part: the projection joins `airtable_sync_state`
 * for the *linked* table so the resolved Airtable record ids are inside the
 * hash. A People record deleted in Airtable and recreated under a new id
 * therefore re-pushes every session that links it, and a link target that has
 * not been synced yet simply produces a short array whose hash flips the moment
 * the target lands. Dependency order becomes an optimization rather than a
 * correctness requirement.
 *
 * jsonb's text form sorts and deduplicates keys, so jsonb *is* the stable
 * stringify — no helper, no key-order footgun, no `crypto.subtle` round trip.
 */

export type CandidateRow = {
  recordPk: string;
  fields: Record<string, unknown>;
  contentHash: string;
};

export type OrphanRow = { recordPk: string; airtableRecordId: string };

/** Everything an organizer types is HTML; Airtable long text is not. */
function plainText(column: SQL): SQL {
  const stripped = sql`regexp_replace(regexp_replace(coalesce(${column}, ''), '<[^>]*>', ' ', 'g'), '\\s+', ' ', 'g')`;
  const decoded = sql`replace(replace(replace(replace(replace(replace(${stripped}, '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&amp;', '&')`;
  return sql`nullif(btrim(${decoded}), '')`;
}

/** One shape for every instant we export, so a timezone change is not a re-push. */
function isoInstant(column: SQL): SQL {
  return sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
}

/**
 * A gated field is projected as SQL `NULL` rather than omitted from the object.
 *
 * Omitting the key would leave whatever we exported last time sitting in the
 * customer's base forever after the organizer switched the gate off — which is
 * the opposite of what switching it off means. Projecting `null` puts the key
 * in the hash, flips it, and the next push clears the column.
 */
function gated(enabled: boolean, column: SQL): SQL {
  return enabled ? column : sql`NULL`;
}

/** Resolved Airtable record ids for a single-valued link, as a jsonb array. */
function linkOne(tableKey: SyncTableKey, foreignKeyColumn: SQL): SQL {
  return sql`coalesce((
    SELECT jsonb_build_array(l.airtable_record_id) FROM link l
    WHERE l.table_name = ${tableKey} AND l.record_pk = ${foreignKeyColumn}::text
  ), '[]'::jsonb)`;
}

function projectedRowsSql(key: SyncTableKey, eventId: EventId, options: AirtableConnectionOptions): SQL {
  switch (key) {
    case "tracks":
      return sql`
        SELECT t.id::text AS record_pk, jsonb_build_object(
          'Openboard ID', t.id::text,
          'Name', t.name,
          'Color', t.color,
          'Description', ${plainText(sql`t.description`)},
          'Sort order', t.sort_order
        ) AS fields
        FROM tracks t WHERE t.event_id = ${eventId}`;
    case "rooms":
      return sql`
        SELECT r.id::text AS record_pk, jsonb_build_object(
          'Openboard ID', r.id::text,
          'Name', r.name,
          'Capacity', r.capacity,
          'Sort order', r.sort_order
        ) AS fields
        FROM rooms r WHERE r.event_id = ${eventId}`;
    case "formats":
      return sql`
        SELECT f.id::text AS record_pk, jsonb_build_object(
          'Openboard ID', f.id::text,
          'Name', f.name,
          'Default duration (mins)', f.default_duration_mins,
          'Sort order', f.sort_order
        ) AS fields
        FROM session_formats f WHERE f.event_id = ${eventId}`;
    case "tags":
      return sql`
        SELECT g.id::text AS record_pk, jsonb_build_object(
          'Openboard ID', g.id::text,
          'Name', g.name,
          'Color', g.color
        ) AS fields
        FROM tags g WHERE g.event_id = ${eventId}`;
    case "people":
      return sql`
        SELECT c.id::text AS record_pk, jsonb_build_object(
          'Openboard ID', c.id::text,
          -- The primary field must never be blank, and it must never fall back
          -- to the email address: that would export an email the organizer may
          -- have gated off, through the one column they cannot switch off.
          'Name', coalesce(nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Speaker ' || left(c.id::text, 8)),
          'First name', nullif(c.first_name, ''),
          'Last name', nullif(c.last_name, ''),
          'Email', ${gated(options.includeEmail, sql`c.email`)},
          'Job title', c.job_title,
          'Company', c.company,
          'Bio', ${gated(options.includeBio, plainText(sql`c.bio_html`))},
          'Pronouns', ${gated(options.includePronouns, sql`c.pronouns`)},
          'Gender', ${gated(options.includeGender, sql`c.gender`)},
          'Confirmation status', c.confirmation_status::text,
          'LinkedIn', c.linkedin_url,
          'Website', c.website_url
        ) AS fields
        FROM contacts c
        WHERE c.event_id = ${eventId}
          -- Programme people only. A ticket buyer never lands in a speaker base.
          AND (
            EXISTS (SELECT 1 FROM session_speakers ss WHERE ss.event_id = c.event_id AND ss.contact_id = c.id)
            OR EXISTS (SELECT 1 FROM submission_participants sp WHERE sp.event_id = c.event_id AND sp.contact_id = c.id)
          )`;
    case "sessions":
      return sql`
        SELECT s.id::text AS record_pk, jsonb_build_object(
          'Openboard ID', s.id::text,
          'Title', s.title,
          'Slug', s.slug,
          'Status', s.status::text,
          'Starts at', ${isoInstant(sql`s.starts_at`)},
          'Ends at', ${isoInstant(sql`s.ends_at`)},
          'Description', ${plainText(sql`s.description_html`)},
          'Track', ${linkOne("tracks", sql`s.track_id`)},
          'Room', ${linkOne("rooms", sql`s.room_id`)},
          'Format', ${linkOne("formats", sql`s.format_id`)},
          -- ORDER BY inside the aggregate is load-bearing: an unordered
          -- jsonb_agg flips the hash on every run and re-pushes the whole table
          -- forever — the "sync is always busy" bug that destroys trust.
          'Speakers', coalesce((
            SELECT jsonb_agg(l.airtable_record_id ORDER BY ss.sort_order, ss.contact_id)
            FROM session_speakers ss
            JOIN link l ON l.table_name = 'people' AND l.record_pk = ss.contact_id::text
            WHERE ss.event_id = s.event_id AND ss.session_id = s.id
          ), '[]'::jsonb)
        ) AS fields
        FROM sessions s WHERE s.event_id = ${eventId}`;
    case "proposals":
      return sql`
        SELECT b.id::text AS record_pk, jsonb_build_object(
          'Openboard ID', b.id::text,
          'Title', b.title,
          'Code', b.code,
          'Status', b.status::text,
          'Kind', b.kind::text,
          'Level', b.level,
          'Language', b.language,
          'Description', ${plainText(sql`b.description_html`)},
          'Submitted at', ${isoInstant(sql`b.submitted_at`)},
          'Decided at', ${isoInstant(sql`b.decided_at`)},
          'Track', ${linkOne("tracks", sql`b.track_id`)},
          'Format', ${linkOne("formats", sql`b.format_id`)},
          'Speakers', coalesce((
            SELECT jsonb_agg(l.airtable_record_id ORDER BY sp.sort_order, sp.contact_id)
            FROM submission_participants sp
            JOIN link l ON l.table_name = 'people' AND l.record_pk = sp.contact_id::text
            WHERE sp.event_id = b.event_id AND sp.submission_id = b.id
          ), '[]'::jsonb),
          'Tags', coalesce((
            SELECT jsonb_agg(l.airtable_record_id ORDER BY sg.tag_id)
            FROM submission_tags sg
            JOIN link l ON l.table_name = 'tags' AND l.record_pk = sg.tag_id::text
            WHERE sg.event_id = b.event_id AND sg.submission_id = b.id
          ), '[]'::jsonb)
        ) AS fields
        FROM submissions b WHERE b.event_id = ${eventId}`;
  }
}

/** `NOT EXISTS` half of the orphan query: does the source row still exist? */
function sourceExistsSql(key: SyncTableKey, eventId: EventId): SQL {
  switch (key) {
    case "tracks":
      return sql`SELECT 1 FROM tracks t WHERE t.event_id = ${eventId} AND t.id::text = s.record_pk`;
    case "rooms":
      return sql`SELECT 1 FROM rooms r WHERE r.event_id = ${eventId} AND r.id::text = s.record_pk`;
    case "formats":
      return sql`SELECT 1 FROM session_formats f WHERE f.event_id = ${eventId} AND f.id::text = s.record_pk`;
    case "tags":
      return sql`SELECT 1 FROM tags g WHERE g.event_id = ${eventId} AND g.id::text = s.record_pk`;
    case "people":
      return sql`
        SELECT 1 FROM contacts c
        WHERE c.event_id = ${eventId} AND c.id::text = s.record_pk
          AND (
            EXISTS (SELECT 1 FROM session_speakers ss WHERE ss.event_id = c.event_id AND ss.contact_id = c.id)
            OR EXISTS (SELECT 1 FROM submission_participants sp WHERE sp.event_id = c.event_id AND sp.contact_id = c.id)
          )`;
    case "sessions":
      return sql`SELECT 1 FROM sessions x WHERE x.event_id = ${eventId} AND x.id::text = s.record_pk`;
    case "proposals":
      return sql`SELECT 1 FROM submissions b WHERE b.event_id = ${eventId} AND b.id::text = s.record_pk`;
  }
}

type CandidateSqlRow = { record_pk: string; fields: Record<string, unknown>; content_hash: string; total: string | number };

/**
 * The changed rows for one table, newest state applied, capped at `limit`.
 * `total` is the full changed count so the caller can report what it deferred.
 */
export async function candidateRecordsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  key: SyncTableKey,
  options: AirtableConnectionOptions,
  limit: number,
): Promise<{ rows: CandidateRow[]; total: number }> {
  const result = await dbOrTx.execute<CandidateSqlRow>(sql`
    WITH link AS (
      SELECT table_name, record_pk, airtable_record_id
      FROM airtable_sync_state WHERE event_id = ${eventId}
    ), projected AS (${projectedRowsSql(key, eventId, options)}
    ), diffed AS (
      SELECT p.record_pk, p.fields, encode(sha256(p.fields::text::bytea), 'hex') AS content_hash FROM projected p
    )
    SELECT d.record_pk, d.fields, d.content_hash, count(*) OVER () AS total
    FROM diffed d
    LEFT JOIN airtable_sync_state st
      ON st.event_id = ${eventId} AND st.table_name = ${key} AND st.record_pk = d.record_pk
    -- IS DISTINCT FROM, not <>: a row with no state row at all is NULL here and
    -- must count as changed.
    WHERE st.content_hash IS DISTINCT FROM d.content_hash
    -- record_pk, not updated_at: a stable, resumable page order across ticks.
    ORDER BY d.record_pk
    LIMIT ${limit}
  `);
  const rows = result.rows ?? [];
  return {
    rows: rows.map((row) => ({ recordPk: row.record_pk, fields: row.fields, contentHash: row.content_hash })),
    total: rows.length === 0 ? 0 : Number(rows[0]?.total ?? 0),
  };
}

type OrphanSqlRow = { record_pk: string; airtable_record_id: string; orphan_total: string | number };

/**
 * Rows we have pushed whose source is gone. Counted on every run whether or not
 * `pruneRemoved` is on — the status card names them either way.
 *
 * The breaker's denominator is *not* returned here. Every count in this query
 * rides on the orphan rows, so a table with no orphans returns no rows and any
 * such total would read 0 no matter how much `airtable_sync_state` holds — the
 * one shape that turns a circuit breaker into a rubber stamp. `syncedRowCountIn`
 * asks that question in its own statement, and is what the caller uses.
 */
export async function orphanRecordsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  key: SyncTableKey,
  limit: number,
): Promise<{ rows: OrphanRow[]; orphanTotal: number }> {
  const result = await dbOrTx.execute<OrphanSqlRow>(sql`
    WITH state AS (
      SELECT record_pk, airtable_record_id FROM airtable_sync_state
      WHERE event_id = ${eventId} AND table_name = ${key}
    ), orphan AS (
      SELECT s.record_pk, s.airtable_record_id FROM state s
      WHERE NOT EXISTS (${sourceExistsSql(key, eventId)})
    )
    SELECT o.record_pk, o.airtable_record_id,
           (SELECT count(*) FROM orphan) AS orphan_total
    FROM orphan o ORDER BY o.record_pk LIMIT ${limit}
  `);
  const rows = result.rows ?? [];
  const first = rows[0];
  return {
    rows: rows.map((row) => ({ recordPk: row.record_pk, airtableRecordId: row.airtable_record_id })),
    orphanTotal: first ? Number(first.orphan_total) : 0,
  };
}

/** How many rows of this table we have ever pushed — the breaker's denominator. */
export async function syncedRowCountIn(dbOrTx: DbOrTx, eventId: EventId, key: SyncTableKey): Promise<number> {
  const result = await dbOrTx.execute<{ total: string | number }>(sql`
    SELECT count(*) AS total FROM airtable_sync_state WHERE event_id = ${eventId} AND table_name = ${key}
  `);
  return Number((result.rows ?? [])[0]?.total ?? 0);
}

/**
 * Persist what a batch actually landed. One statement per batch, keyed on the
 * table's natural unique constraint, so a replay is a no-op rather than a
 * duplicate.
 */
export async function recordSyncedRowsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  key: SyncTableKey,
  rows: readonly { recordPk: string; airtableRecordId: string; contentHash: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  const values = sql.join(
    rows.map((row) => sql`(${eventId}::uuid, ${key}, ${row.recordPk}, ${row.airtableRecordId}, ${row.contentHash}, now())`),
    sql`, `,
  );
  await dbOrTx.execute(sql`
    INSERT INTO airtable_sync_state (event_id, table_name, record_pk, airtable_record_id, content_hash, last_synced_at)
    VALUES ${values}
    ON CONFLICT (event_id, table_name, record_pk) DO UPDATE
      SET airtable_record_id = EXCLUDED.airtable_record_id,
          content_hash = EXCLUDED.content_hash,
          last_synced_at = EXCLUDED.last_synced_at
  `);
}

export async function forgetSyncedRowsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  key: SyncTableKey,
  recordPks: readonly string[],
): Promise<void> {
  if (recordPks.length === 0) return;
  const list = sql.join(recordPks.map((pk) => sql`${pk}`), sql`, `);
  await dbOrTx.execute(sql`
    DELETE FROM airtable_sync_state
    WHERE event_id = ${eventId} AND table_name = ${key} AND record_pk IN (${list})
  `);
}
