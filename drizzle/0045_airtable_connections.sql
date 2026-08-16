-- M39 — the Airtable integration becomes real, and it becomes the customer's.
--
-- Until now `airtable_sync_state`/`airtable_sync_runs` existed with nothing to
-- drive them, and the only credential in the design was a single global
-- `AIRTABLE_API_KEY` — a cross-tenant write waiting to happen. This table
-- replaces that with one connection per event, holding a personal access token
-- the organizer pasted from their own Airtable account.
--
-- The token is stored sealed (AES-GCM under `SESSION_SECRET`, HKDF context
-- `airtable_pat-v1`, AAD bound to `(event_id, id)`) exactly the way
-- `communication_logs.secret_payload_ciphertext` carries a one-shot portal
-- credential. `token_hint` is the last four characters and `token_fingerprint`
-- is a sha256 — both exist so the settings panel and support can identify a
-- token without anything unsealing one.
CREATE TABLE airtable_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  token_ciphertext bytea NOT NULL,
  token_hint text NOT NULL,
  token_fingerprint text NOT NULL,
  airtable_user_id text NOT NULL,
  account_email text,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  base_id text,
  base_name text,
  sync_enabled boolean NOT NULL DEFAULT true,
  options jsonb NOT NULL DEFAULT '{"includeEmail":true,"includeBio":true,"includePronouns":false,"includeGender":false,"pruneRemoved":false}'::jsonb,
  schema_snapshot jsonb,
  schema_fingerprint text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  next_sync_after timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz,
  last_error_key text,
  connected_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT airtable_connections_id_event_id_unique UNIQUE (id, event_id),
  CONSTRAINT airtable_connections_status_check CHECK (status IN ('pending', 'connected', 'needs_attention')),
  CONSTRAINT airtable_connections_base_id_check CHECK (base_id IS NULL OR btrim(base_id) <> ''),
  CONSTRAINT airtable_connections_token_hint_check CHECK (char_length(token_hint) BETWEEN 1 AND 8),
  CONSTRAINT airtable_connections_failures_check CHECK (consecutive_failures >= 0)
);

-- The cron sweep's only selection predicate: connected rows whose next attempt
-- is due. `needs_attention` rows fall out of it by status, which is how a
-- revoked token stops costing an outbound call every fifteen minutes.
CREATE INDEX airtable_connections_due_idx ON airtable_connections (status, next_sync_after);

-- `blocked` joins the run states. Deliberately distinct from `failed`: a
-- missing scope is the organizer's to fix and must not reach the operator's
-- error budget, but it is also not a success and must not read as one.
--
-- `NOT VALID` for the reason 0044 spells out at length: the predicate being
-- replaced logically implies this one (every row that satisfied
-- 'running'/'success'/'failed' satisfies the wider set), so the validation scan
-- can find nothing, and skipping it avoids holding ACCESS EXCLUSIVE over a
-- table the sync engine writes on every tick. Enforcement on INSERT and UPDATE
-- is immediate either way.
ALTER TABLE airtable_sync_runs DROP CONSTRAINT airtable_sync_runs_status_check;
ALTER TABLE airtable_sync_runs ADD CONSTRAINT airtable_sync_runs_status_check
  CHECK (status IN ('running', 'success', 'failed', 'blocked')) NOT VALID;

ALTER TABLE airtable_sync_runs ADD COLUMN lease_expires_at timestamptz;

-- Mutual exclusion for a manual "Sync now" racing a cron tick, decided by the
-- database rather than by a check-then-act: the loser gets 23505 and is
-- reported as skipped, never as a second run pushing the same records.
CREATE UNIQUE INDEX airtable_sync_runs_one_active_idx
  ON airtable_sync_runs (event_id) WHERE status = 'running';
CREATE INDEX airtable_sync_runs_event_started_idx
  ON airtable_sync_runs (event_id, started_at DESC);
