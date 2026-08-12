-- Versioned, privacy-minimal evidence for self-service signup consent. Policy
-- copy remains outside this migration: deployment configuration names the
-- reviewed URLs and stable versions, while this table records exactly the
-- pair shown to the user and the database time at which they accepted it.

CREATE TABLE user_legal_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  source text NOT NULL DEFAULT 'signup',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_legal_acceptances_user_versions_key UNIQUE (user_id, terms_version, privacy_version),
  CONSTRAINT user_legal_acceptances_terms_version_ck CHECK (length(trim(terms_version)) BETWEEN 1 AND 80),
  CONSTRAINT user_legal_acceptances_privacy_version_ck CHECK (length(trim(privacy_version)) BETWEEN 1 AND 80),
  CONSTRAINT user_legal_acceptances_source_ck CHECK (source = 'signup')
);

CREATE INDEX user_legal_acceptances_user_time_idx
  ON user_legal_acceptances (user_id, accepted_at DESC);
