-- M43 — organization tenancy.
--
-- Additive throughout. It adds the layer *above* events: an `organizations`
-- table, an `organization_members` membership/role table, and one new column
-- on `events`. Nothing existing is dropped, renamed or narrowed, and no
-- applied migration is edited (DECISIONS.md, "Migration authorship" — this
-- file is hand-authored SQL like every other file in `drizzle/`).
--
-- Three things are worth reading before changing anything here.
--
-- 1. `events.organization_id` is NOT NULL *with a column DEFAULT*.
--    That default is what makes this migration additive rather than a
--    fleet-wide rewrite: every existing writer of an `events` row — M11's
--    `createEventIn`, `scripts/seed/*`, and the ~40 test fixtures that say
--    `INSERT INTO events(id,name,slug,starts_at,ends_at)` — keeps working
--    unchanged and lands in the default organization. Existing rows are
--    backfilled by the same `ADD COLUMN … DEFAULT`, so the "backfill existing
--    single-org data into a default organization" step is not a second pass
--    that could be skipped or run twice. M45's self-serve creation flow will
--    pass an explicit `organization_id`; dropping the default is a later,
--    separate migration once no writer relies on it, not something to smuggle
--    in here.
--
-- 2. The composite-FK chain is extended one level, not rewritten.
--    Every event-scoped table already carries `UNIQUE (id, event_id)` so its
--    children can pin themselves to the same tenant with a composite foreign
--    key. `events` now carries the same shape one level up —
--    `UNIQUE (id, organization_id)` — so an organization-scoped table (M47's
--    export jobs, M49's plans/entitlements) can declare
--    `FOREIGN KEY (event_id, organization_id) REFERENCES events(id, organization_id)`
--    and have the database reject a row that mixes two organizations, exactly
--    the way `submissions(track_id,event_id) -> tracks(id,event_id)` already
--    rejects a row that mixes two events. No event-scoped child table is
--    touched: they stay pinned to their event, and the event is pinned to its
--    organization, so the chain is transitive.
--
-- 3. Membership reuses the `member_role` enum on purpose.
--    `owner > organizer > reviewer` is one ladder with one ranking function
--    (`roleSatisfies`), so an organization-scoped guard cannot rank roles
--    differently from the event-scoped one it composes with. A second enum
--    would be a second ladder and the two would eventually disagree.
--    Organization membership is deliberately NOT event access: `requireAdmin`
--    still reads `event_members` and nothing else, so the per-event contract
--    is unchanged by this migration and by everything that reads it.

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (btrim(name) <> ''),
  -- Same slug grammar and reserved list as `events` (0000_init.sql): an
  -- organization slug is a future top-level path segment, so it must not be
  -- able to collide with one of the app's own routes.
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](-?[a-z0-9])*$')
    CHECK (slug NOT IN ('api','submit','admin','portal','e','embed','assets','app','cal','f','login')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The default organization every pre-M43 event belongs to. The id is fixed
-- and quoted in `src/shared/contracts/organization.ts` as
-- `DEFAULT_ORGANIZATION_ID` so application code and tests can name the row the
-- backfill below created without re-deriving it from the slug.
INSERT INTO organizations (id, name, slug)
VALUES ('d3fa0000-0000-4000-8000-000000000001', 'Default Organization', 'default');

CREATE TABLE organization_members (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'organizer',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);
CREATE INDEX organization_members_organization_idx ON organization_members(organization_id);

-- Every existing admin joins the default organization at their strongest
-- event role, so the organization layer arrives populated rather than as an
-- empty table that locks every current organizer out of every
-- organization-scoped surface. One row per user, highest rank wins, so the
-- result does not depend on which event a user happens to be listed against
-- first. `ON CONFLICT DO NOTHING` keeps it re-runnable against a database
-- where a row already exists.
INSERT INTO organization_members (user_id, organization_id, role)
SELECT
  user_id,
  'd3fa0000-0000-4000-8000-000000000001'::uuid,
  (CASE
    WHEN bool_or(role = 'owner') THEN 'owner'
    WHEN bool_or(role = 'organizer') THEN 'organizer'
    ELSE 'reviewer'
  END)::member_role
FROM event_members
GROUP BY user_id
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- The one new column on an existing table. `ON DELETE RESTRICT` is
-- deliberate: an organization row is not a safe cascade root — deleting one
-- would silently take every event, submission, contact and file row under it
-- with no confirmation. M47's erasure flow deletes events explicitly and then
-- the organization; until then the database refuses to lose an event by
-- accident.
ALTER TABLE events
  ADD COLUMN organization_id uuid NOT NULL
    DEFAULT 'd3fa0000-0000-4000-8000-000000000001'
    REFERENCES organizations(id) ON DELETE RESTRICT;

-- The key that extends the composite-FK chain one level (see note 2 above).
ALTER TABLE events ADD CONSTRAINT events_id_organization_key UNIQUE (id, organization_id);
CREATE INDEX events_organization_idx ON events(organization_id);
