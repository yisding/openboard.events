-- P3-EMAIL: bounce/complaint suppression, CAN-SPAM physical address.
--
-- Additive throughout. Appended enum labels only, same discipline as
-- 0004_review_operations.sql's `template_key` additions: `ALTER TYPE …
-- ADD VALUE` is legal inside the migration transaction on PostgreSQL 12+ as
-- long as the new label is not *used* in the same transaction — nothing
-- below writes a comm_status of 'bounced'/'complained', that only happens at
-- runtime from the Resend webhook handler.
ALTER TYPE comm_status ADD VALUE IF NOT EXISTS 'bounced';
ALTER TYPE comm_status ADD VALUE IF NOT EXISTS 'complained';

-- Suppression state lives in its own table rather than as columns on
-- `contacts`. `contacts` writes (`getOrCreateContact`/`updateContactFields`,
-- resolution #13) use an unqualified `.returning()`/insert — every declared
-- column — so new `contacts` columns would break every PGlite fixture across
-- every feature that creates or edits a contact and has not also applied
-- this migration; a separate table confines that blast radius to the comms
-- feature's own fixtures. A row's mere presence means "suppressed" — there
-- is no unsuppress path today (M46's "suppression list UI" is a later,
-- product-facing phase), so no nullable-pair column is needed.
--
-- Why this is not `contacts.unsubscribed_at` reused: that column is the
-- contact's own preference (opts out of non-essential mail only, per
-- `TRANSACTIONAL_TEMPLATE_KEYS`); this is provider-driven proof the address
-- is undeliverable or has reported the sender as spam, and suppresses every
-- send, including decision/schedule/portal-login mail.
CREATE TYPE suppression_reason AS ENUM ('bounce', 'complaint');
CREATE TABLE contact_suppressions (
  contact_id uuid PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  reason suppression_reason NOT NULL,
  suppressed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_suppressions_event_idx ON contact_suppressions (event_id);

-- The webhook's only lookup key: match the inbound Resend event back to the
-- outbox row that produced it. Partial (most rows in log/local email mode
-- never carry a real provider id) so the index stays small.
CREATE INDEX communication_logs_provider_message_idx
  ON communication_logs (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- CAN-SPAM's required physical postal address, rendered in the email layout
-- footer (src/features/comms/server/layout.ts). Nullable: an event that has
-- not filled it in yet just omits the footer line, same as `location`. Only
-- `features/events` writes `events` through an unqualified `.returning()`
-- (`createEventIn`/`updateEventIn`), and that feature's own PGlite fixture
-- already applies every migration it needs, so this column carries none of
-- `contact_suppressions`' cross-feature blast-radius concern.
ALTER TABLE events
  ADD COLUMN physical_address text;
