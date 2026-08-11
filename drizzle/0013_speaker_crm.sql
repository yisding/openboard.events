-- M55 — organization-level speaker CRM.
--
-- Purely additive on top of M43's `organizations` (0010), M44's `users`
-- membership, and M51's event-scoped `contacts` (0008). No applied migration
-- is edited (DECISIONS.md, "Migration authorship").
--
-- The central design choice: `organization_contacts` is a NEW identity, not
-- a widened `contacts`. The guardrail is explicit — "CRM introduces an
-- explicit organization identity/link rather than silently collapsing event
-- rows" — so this file never touches `contacts` at all. Instead
-- `organization_contact_links` is the many-(event contacts)-to-one
-- (organization identity) join, and every write to an event `contacts` row
-- that this module performs (`pushOrganizationContactToEventIn`) still goes
-- through `getOrCreateContact`/`updateContactFields` at the application
-- layer (resolution #13) — nothing here is a second contacts writer.
--
-- Every child table carries `organization_id` directly, not only reachable
-- by joining through `organization_contacts`, so a read's WHERE clause is
-- always organization-scoped on its own — the same discipline
-- `organizations/server/queries.ts` documents — and most also FK through the
-- `(id, organization_id)` composite key so a row can never point at a
-- contact/tag/field that belongs to a different organization.
--
-- `organization_contact_pipeline.target_event_id` is the one exception: it
-- is a plain FK to `events(id)`, not a composite `(target_event_id,
-- organization_id)` FK. A composite FK's `ON DELETE SET NULL` nulls out
-- *every* column in the FK when it fires — including `organization_id` here,
-- which is this row's own tenant column and is used by other constraints/
-- reads, not just this one. Nulling it out on event deletion would silently
-- de-scope the row. The application layer
-- (`createPipelineEntryIn`/`updatePipelineEntryIn`) checks the target
-- event's organization before insert instead.

CREATE TYPE crm_contact_source AS ENUM ('manual', 'import', 'event_sync', 'merge');
CREATE TYPE crm_activity_kind AS ENUM (
  'created', 'note_added', 'tag_added', 'tag_removed', 'field_changed',
  'event_linked', 'merged_from', 'merged_into', 'pipeline_created',
  'pipeline_stage_changed', 'email_sent', 'imported'
);
CREATE TYPE crm_pipeline_stage AS ENUM ('open', 'won', 'lost');

CREATE TABLE organization_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email))),
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  company text,
  job_title text,
  bio_html text,
  linkedin_url text,
  twitter_url text,
  website_url text,
  source crm_contact_source NOT NULL DEFAULT 'manual',
  custom_fields jsonb NOT NULL DEFAULT '{}',
  -- Set only when this row lost a merge (see `organization_contact_merges`
  -- below). Self-referencing FK declared after the table exists. The row is
  -- never deleted, so every note/activity/link/pipeline row that pointed at
  -- it stays valid and readable through the merge audit trail.
  merged_into_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, email),
  UNIQUE (id, organization_id)
);
ALTER TABLE organization_contacts
  ADD CONSTRAINT organization_contacts_merged_into_fk
  FOREIGN KEY (merged_into_id) REFERENCES organization_contacts(id) ON DELETE SET NULL;
CREATE INDEX organization_contacts_org_idx ON organization_contacts(organization_id, email);

-- One row per (event, event-contact) the organization identity has been
-- pushed into or matched with. `UNIQUE (event_id, contact_id)` plus
-- `pushOrganizationContactToEventIn`'s `onConflictDoNothing` is what makes
-- "push into an event twice" idempotent.
CREATE TABLE organization_contact_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  organization_contact_id uuid NOT NULL,
  event_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, contact_id),
  FOREIGN KEY (organization_contact_id, organization_id) REFERENCES organization_contacts(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (event_id, organization_id) REFERENCES events(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX organization_contact_links_contact_idx ON organization_contact_links(organization_contact_id);
CREATE INDEX organization_contact_links_org_event_idx ON organization_contact_links(organization_id, event_id);

CREATE TABLE organization_contact_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  color text NOT NULL DEFAULT '#00a878',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (id, organization_id)
);

CREATE TABLE organization_contact_tag_links (
  organization_id uuid NOT NULL,
  organization_contact_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_contact_id, tag_id),
  FOREIGN KEY (organization_contact_id, organization_id) REFERENCES organization_contacts(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id, organization_id) REFERENCES organization_contact_tags(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX organization_contact_tag_links_tag_idx ON organization_contact_tag_links(tag_id);

-- Field *definitions* only. Values live inline on
-- `organization_contacts.custom_fields` (JSON keyed by `key`), not a fourth
-- EAV table — see `src/db/schema/crm.ts`'s comment on
-- `organizationContactCustomFields` for why.
CREATE TABLE organization_contact_custom_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9_]*$'),
  label text NOT NULL CHECK (btrim(label) <> ''),
  field_type speaker_logistics_field_type NOT NULL DEFAULT 'text',
  options text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE TABLE organization_contact_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  organization_contact_id uuid NOT NULL,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body_html text NOT NULL CHECK (btrim(body_html) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_contact_id, organization_id) REFERENCES organization_contacts(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX organization_contact_notes_contact_idx ON organization_contact_notes(organization_contact_id, created_at);

-- Append-only activity timeline. Every mutation in `src/features/crm` writes
-- exactly one row here as its last statement.
CREATE TABLE organization_contact_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  organization_contact_id uuid NOT NULL,
  kind crm_activity_kind NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_contact_id, organization_id) REFERENCES organization_contacts(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX organization_contact_activity_contact_idx ON organization_contact_activity(organization_contact_id, created_at);

-- A saved dynamic segment. `filter` is a `CrmSegmentFilter`
-- (`src/shared/contracts/crm.ts`), resolved fresh on every read by
-- `resolveCrmSegmentIn` — no membership rows are materialized, so an
-- underlying field edit changes membership on the very next resolve with
-- nothing to invalidate.
CREATE TABLE organization_contact_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (btrim(name) <> ''),
  filter jsonb NOT NULL DEFAULT '{}',
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

-- The immutable merge audit record. `field_snapshot` contains the losing
-- contact plus a private compare-and-restore snapshot captured by the merge
-- transaction. `reference_counts` is how many rows of each kind
-- (links/tags/notes/activity/pipeline) were reassigned onto the primary.
-- No update/delete path anywhere in `src/features/crm` touches this table once
-- written. The append-only recovery receipt is added by migration 0017.
CREATE TABLE organization_contact_merges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  primary_contact_id uuid NOT NULL,
  merged_contact_id uuid NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  field_snapshot jsonb NOT NULL,
  reference_counts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (primary_contact_id, organization_id) REFERENCES organization_contacts(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (merged_contact_id, organization_id) REFERENCES organization_contacts(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX organization_contact_merges_org_idx ON organization_contact_merges(organization_id, created_at);

-- The sourcing kanban: one row per prospect-to-event effort, three-state
-- lifecycle (open/won/lost) per the work order. See this file's header for
-- why `target_event_id` is a plain, not composite, FK.
CREATE TABLE organization_contact_pipeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  organization_contact_id uuid NOT NULL,
  target_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  stage crm_pipeline_stage NOT NULL DEFAULT 'open',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_contact_id, organization_id) REFERENCES organization_contacts(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX organization_contact_pipeline_contact_idx ON organization_contact_pipeline(organization_contact_id);

CREATE TABLE organization_contact_pipeline_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  pipeline_id uuid NOT NULL REFERENCES organization_contact_pipeline(id) ON DELETE CASCADE,
  from_stage crm_pipeline_stage,
  to_stage crm_pipeline_stage NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_stage IS DISTINCT FROM to_stage)
);
CREATE INDEX organization_contact_pipeline_history_pipeline_idx ON organization_contact_pipeline_history(pipeline_id, created_at);
