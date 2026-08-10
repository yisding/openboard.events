-- M51 — standalone speaker roster operations.
--
-- Additive throughout: one new column on `contacts` with a default that
-- reproduces "never contacted yet" for every existing row, three new
-- event-scoped tables for organizer-defined logistics fields/values and
-- declared blackout intervals, and a fourth that carries the ad hoc
-- subject/body for a personalized bulk send (looked up by `idempotency_key`
-- at render time — see `buildContext`'s `speaker_bulk_message` branch —
-- rather than widening `communication_logs`, which every other feature's
-- fixtures already insert into with an unqualified column list). Nothing here
-- rewrites an applied migration, and all contact writes below still go
-- through `getOrCreateContact`/`updateContactFields` at the application
-- layer (resolution #13) — this file only adds the columns/tables those
-- helpers and their new callers use.

-- Appended label only. `ALTER TYPE … ADD VALUE` is legal inside the migration
-- transaction on PostgreSQL 12+ as long as the new label is not *used* in the
-- same transaction — nothing below writes one; the per-event template row is
-- seeded at runtime by `seedDefaultTemplates`, same discipline as M50's two
-- appended labels (drizzle/0004_review_operations.sql).
ALTER TYPE template_key ADD VALUE IF NOT EXISTS 'speaker_bulk_message';

-- Organizer pipeline tracking, deliberately separate from
-- `confirmation_status` (which drives `published_speakers_v` and is set
-- automatically on accept+notify, resolution #15). `workflow_status` is pure
-- roster bookkeeping — it never gates publication, notification, or any other
-- read model — so the two can never contradict each other.
CREATE TYPE speaker_workflow_status AS ENUM ('new', 'contacted', 'invited', 'confirmed', 'declined', 'withdrawn');
ALTER TABLE contacts ADD COLUMN workflow_status speaker_workflow_status NOT NULL DEFAULT 'new';

-- Event-scoped organizer-defined logistics fields (text or single-select) and
-- their per-contact values. A field definition is deleted only by cascade
-- from its event; a value row is deleted only by cascade from its field or
-- its contact, so removing a field cleans up every contact's answer to it in
-- the same statement rather than leaving orphaned values a later field with a
-- reused id could inherit.
CREATE TYPE speaker_logistics_field_type AS ENUM ('text', 'select');
CREATE TABLE speaker_logistics_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (btrim(key) <> ''),
  label text NOT NULL CHECK (btrim(label) <> ''),
  field_type speaker_logistics_field_type NOT NULL DEFAULT 'text',
  -- Only meaningful when field_type='select'; empty for 'text'.
  options text[] NOT NULL DEFAULT '{}',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, key),
  UNIQUE (id, event_id)
);
CREATE TABLE speaker_logistics_values (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  field_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (field_id, contact_id),
  FOREIGN KEY (field_id, event_id) REFERENCES speaker_logistics_fields(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE CASCADE
);
CREATE INDEX speaker_logistics_values_contact_idx ON speaker_logistics_values (event_id, contact_id);

-- Declared blackout intervals. Stored as UTC (the column type already
-- guarantees that); the event timezone is applied only at the display/edit
-- boundary. `replaceSpeakerUnavailabilityIn` (one guarded CTE) is this
-- table's sole writer, so add/edit/remove in a single organizer save can
-- never leave a partial set. M54 reads through the exported
-- `listSpeakerUnavailability` query rather than this table directly.
CREATE TABLE contact_unavailability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE CASCADE,
  UNIQUE (id, event_id),
  CHECK (ends_at > starts_at)
);
CREATE INDEX contact_unavailability_contact_idx ON contact_unavailability (event_id, contact_id, starts_at);

-- One row per personalized bulk send to one contact: the ad hoc
-- subject/body an organizer typed for that recipient (already merge-rendered
-- at compose/preview time — see `composeBulkSpeakerEmailIn`), keyed by the
-- exact `idempotency_key` the matching `communication_logs` row will carry.
-- `buildContext` looks this row up by that key when it renders a
-- `speaker_bulk_message` outbox row (comms/server/context.ts), which is how a
-- one-off compose reaches the shared dispatcher without a ninth `withTx` path
-- or a new column on `communication_logs`.
CREATE TABLE speaker_bulk_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  subject text NOT NULL,
  body_html text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE CASCADE
);
CREATE INDEX speaker_bulk_messages_event_idx ON speaker_bulk_messages (event_id, created_at DESC);
