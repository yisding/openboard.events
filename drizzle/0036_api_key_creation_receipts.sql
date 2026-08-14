-- A caller-owned API-key operation id remains consumed after key revocation.
-- This lets a lost-response replay prove an exact committed create without
-- storing the plaintext, while preventing a delayed retry from resurrecting a
-- deliberately revoked credential.
CREATE TABLE api_key_creation_receipts (
  operation_id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  payload_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_key_creation_receipts_payload_fingerprint_ck
    CHECK (btrim(payload_fingerprint) <> '')
);

CREATE INDEX api_key_creation_receipts_event_idx
  ON api_key_creation_receipts(event_id);
