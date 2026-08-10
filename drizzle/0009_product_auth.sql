-- M42 — product auth: Better Auth (Drizzle adapter) for admin/organizer sign-in.
--
-- Purely additive. The jose/PBKDF2 fallback keeps working against `users`
-- unchanged; these tables are what Better Auth reads when
-- `ADMIN_AUTH_PROVIDER=better-auth` flips the switch (DECISIONS.md, "Product
-- auth direction": the fallback remains the shipping auth until a deployed
-- round-trip is proven).
--
-- The three tables are Better Auth's `account`/`session`/`verification` models
-- under admin-prefixed names, mapped in `src/db/schema/admin-auth.ts`. They are
-- fully isolated from `portal_sessions`/`portal_tokens` — the speaker OTP and
-- magic-link path does not move in M42 (M42 AC 3).

-- Better Auth's `user` model requires `emailVerified` and `image`. Both are
-- additive with safe defaults; nothing existing reads them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS image text;

-- Credential + social provider links. `password` holds the credential hash for
-- email+password sign-in; the OAuth columns hold Google's tokens. Ids are uuid
-- with a database default so Better Auth runs with
-- `advanced.database.generateId: false` and every foreign key stays uuid, the
-- same type as `users.id`.
CREATE TABLE admin_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  password text,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX admin_accounts_user_idx ON admin_accounts(user_id);

-- The revocable server-side admin session store (M42 AC 3/AC 4).
--
-- `admin_sessions` was created in 0000_init.sql and never written to — the
-- hackathon fallback issued a stateless jose JWT instead. M42 is what the
-- roadmap called "finally using an `admin_sessions`-shaped store", so this
-- extends the existing table in place rather than adding a second one.
--
-- A row *is* the session: deleting it revokes it, and `requireAdmin` re-reads
-- this table on every request, so revocation takes effect immediately instead
-- of waiting out a signed cookie's expiry the way the fallback does.
--
-- `token_hash` loses its NOT NULL because nothing ever populated it and Better
-- Auth looks sessions up by the token it holds in `token`. The table is empty
-- in every environment, so this widens a constraint over zero rows.
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS token text;
ALTER TABLE admin_sessions ALTER COLUMN token_hash DROP NOT NULL;
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE admin_sessions ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS admin_sessions_token_key ON admin_sessions(token);
CREATE INDEX IF NOT EXISTS admin_sessions_user_idx ON admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions(expires_at);

-- Short-lived verification values: password-reset tokens, email-verification
-- tokens, and the OAuth state/PKCE records Better Auth writes during the Google
-- round-trip.
CREATE TABLE admin_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_verifications_identifier_idx ON admin_verifications(identifier);

-- M42 AC 1 — no forced resets and no orphaned accounts. Every existing
-- `users.password_hash` becomes a Better Auth credential account carrying the
-- *legacy* PBKDF2 string verbatim; `src/features/auth/server/admin-password.ts`
-- verifies that scheme through Better Auth's custom hashing hooks and rehashes
-- it to the v2 scheme on the first successful sign-in.
INSERT INTO admin_accounts (user_id, account_id, provider_id, password)
SELECT id, id::text, 'credential', password_hash
FROM users
WHERE password_hash IS NOT NULL
ON CONFLICT (provider_id, account_id) DO NOTHING;

-- Admin auth mail rides the existing outbox (`enqueueEmail`), so it needs
-- template keys. Both are transactional/security mail: see
-- `TRANSACTIONAL_TEMPLATE_KEYS` in `src/shared/contracts/comms.ts`.
ALTER TYPE template_key ADD VALUE IF NOT EXISTS 'admin_password_reset';
ALTER TYPE template_key ADD VALUE IF NOT EXISTS 'admin_email_verification';

-- Both new templates carry a one-shot credential (the reset / verification
-- URL), so they need the same sealed-payload channel `portal_login` uses. The
-- original CHECK in 0000_init.sql allowed `portal_login` alone; widen it to the
-- three credential-bearing keys.
--
-- The predicate compares `template_key::text` rather than enum literals on
-- purpose: PostgreSQL refuses to *use* an enum value added earlier in the same
-- transaction, and drizzle-kit runs each migration file in one.
DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'communication_logs'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%secret_payload_ciphertext IS NULL%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE communication_logs DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE communication_logs ADD CONSTRAINT communication_logs_secret_payload_check
  CHECK (
    template_key::text IN ('portal_login', 'admin_password_reset', 'admin_email_verification')
    OR secret_payload_ciphertext IS NULL
  );
