-- One embed row per (event, content type), enforced by the database.
--
-- `embeds` was created as a general multi-type table, so nothing stopped a
-- second row for a pair the product only ever treats as one. Every reader goes
-- through `findRow`, which takes the *earliest* row for the pair — including
-- `isEmbedEnabledIn`, the public route's kill switch — while
-- `getOrCreateEmbedConfigIn` handed back the row it had just inserted. Two
-- admins opening the embeds page at once for a never-configured event both
-- inserted, and the one holding its own row then PATCHed the duplicate
-- forever: every toggle looked saved, and the public route kept serving the
-- other row.
--
-- The reader change alone would leave "earliest row wins" load-bearing for
-- good. This makes the duplicate unrepresentable instead, which is what lets
-- the creators use ON CONFLICT DO NOTHING and stop racing at all.
--
-- The DELETE is a no-op on any database the race never hit, and on one it did
-- it removes only rows nothing has ever served: `findRow`'s ORDER BY
-- created_at means the surviving row is exactly the row every public reader,
-- every kill-switch check and every list already resolved. `id` breaks a
-- created_at tie so the choice is deterministic rather than whatever the
-- planner returned that day. Nothing in the database references `embeds`, so
-- there is no cascade to consider.
DELETE FROM embeds duplicate
USING embeds surviving
WHERE duplicate.event_id = surviving.event_id
  AND duplicate.content_type = surviving.content_type
  AND (surviving.created_at, surviving.id) < (duplicate.created_at, duplicate.id);

ALTER TABLE embeds
  ADD CONSTRAINT embeds_event_id_content_type_unique UNIQUE (event_id, content_type);
