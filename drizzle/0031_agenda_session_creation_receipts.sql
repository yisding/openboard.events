-- A caller-owned agenda session creation id must remain consumed after the
-- session is hard-deleted. Otherwise a delayed retry of the original POST sees
-- a free sessions.id and silently resurrects the deleted session.
--
-- The receipt is inserted by the same data-modifying CTE as the session row,
-- speaker links and first content revision. Failed creates therefore leave no
-- tombstone, while deleting only the session deliberately preserves it.
CREATE TABLE session_creation_receipts (
  creation_id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  payload_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_creation_receipts_payload_fingerprint_ck
    CHECK (btrim(payload_fingerprint) <> '')
);

CREATE INDEX session_creation_receipts_event_idx
  ON session_creation_receipts(event_id);
