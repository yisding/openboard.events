-- M39 — speaker headshots reach Airtable as attachments (issue #643).
--
-- `airtable_connections.options` gains `includeHeadshots`, defaulting **on**
-- for the same reason `includeBio` does: a headshot is public programme copy
-- that already renders on the event's own speaker page, and a speaker roster in
-- Airtable without faces is the gap this integration was most visibly missing.
--
-- Both halves matter. The column default only reaches rows inserted from here
-- on; the backfill is what makes every already-connected event behave like a
-- newly-connected one. Without it `options->>'includeHeadshots'` is SQL NULL on
-- those rows, the projection reads it as "off", and the feature silently never
-- arrives for exactly the organizers who have been using the integration
-- longest — while the settings panel renders the toggle as unchecked and offers
-- no explanation.
--
-- `jsonb_set` rather than `||` so a row that somehow already carries the key
-- (an option PATCH racing the deploy) keeps whatever it says, and the guard
-- means re-running this migration writes nothing.

ALTER TABLE airtable_connections
  ALTER COLUMN options SET DEFAULT '{"includeEmail":true,"includeBio":true,"includePronouns":false,"includeGender":false,"includeHeadshots":true,"pruneRemoved":false}'::jsonb;

UPDATE airtable_connections
SET options = jsonb_set(options, '{includeHeadshots}', 'true'::jsonb),
    -- Not `next_sync_after`: the newly-included column flips every People row's
    -- content hash on its own, so the backfill lands on the next scheduled run
    -- without turning a deploy into a thundering herd of immediate syncs.
    updated_at = now()
WHERE NOT (options ? 'includeHeadshots');
