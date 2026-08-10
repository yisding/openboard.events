-- M44 — user management: self-serve signup, team invitations, and a light
-- audit trail over organization membership and admin sessions.
--
-- Purely additive on top of M43's `organizations`/`organization_members`
-- (drizzle/0010_organization_tenancy.sql) and M42's `admin_sessions`
-- (drizzle/0009_product_auth.sql). Nothing here alters an existing table's
-- meaning; both new tables are owned end to end by this migration.

-- Pending team invitations. A user row does not have to exist yet — invites
-- are addressed to an email, and `accepted_user_id` is filled in only once
-- someone with that email actually accepts (either by signing up fresh or by
-- accepting while already signed in as a different organization's member).
--
-- One *live* (not yet accepted, not yet revoked) invitation per
-- organization+email: the partial unique index below is also the `ON
-- CONFLICT` target for "invite again" (src/features/organizations/server/
-- invitations.ts), so re-inviting the same address refreshes the row in
-- place — role, inviter, expiry — instead of erroring or leaving duplicates.
CREATE TABLE organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email))),
  role member_role NOT NULL DEFAULT 'organizer',
  token_hash text NOT NULL UNIQUE,
  invited_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz
);
CREATE INDEX organization_invitations_org_idx ON organization_invitations(organization_id, created_at DESC);
CREATE UNIQUE INDEX organization_invitations_pending_email_idx
  ON organization_invitations(organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
-- The signup hook (`buildAdminAuth`'s `databaseHooks.user.create.after`)
-- looks up a pending invitation by email alone, across every organization —
-- this is what makes that lookup a single indexed query instead of a scan.
CREATE INDEX organization_invitations_pending_lookup_idx
  ON organization_invitations(email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- A light, append-only audit trail over organization membership actions —
-- who invited/removed/promoted whom, and when a pending invitation was
-- revoked or accepted. `actor_user_id`/`target_user_id` are `ON DELETE SET
-- NULL` rather than CASCADE: a deleted user must not silently erase the
-- history of what they did, or what was done to them.
CREATE TABLE organization_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organization_audit_log_org_created_idx ON organization_audit_log(organization_id, created_at DESC);

-- Team invitations ride the existing outbox (`enqueueEmail`), so they need a
-- template key. Appended, never reordered — `template_key` is a Postgres
-- enum whose existing labels are already stored (same discipline as every
-- earlier `ALTER TYPE` in this journal).
-- `ALTER TYPE … ADD VALUE` makes a value unusable until the transaction that
-- added it commits — and drizzle applies a pending migration batch in ONE
-- transaction, so 0014's backfill (which inserts rows with these keys) would
-- fail with "unsafe use of new value of enum type". Recreate the enum instead:
-- transaction-safe and the labels are usable immediately.
-- The stored CHECK pins the enum with an explicit cast ('portal_login'::template_key),
-- which would compare old-type against new-type mid-ALTER. Drop and re-add around it.
ALTER TABLE communication_logs DROP CONSTRAINT communication_logs_secret_payload_check;
CREATE TYPE template_key_v11 AS ENUM ('submission_received','submission_accepted','submission_declined','task_assigned','task_reminder','schedule_assigned','schedule_changed','portal_login','reviewer_invited','review_reminder','speaker_bulk_message','admin_password_reset','admin_email_verification','organization_invited');
ALTER TABLE email_templates ALTER COLUMN key TYPE template_key_v11 USING key::text::template_key_v11;
ALTER TABLE communication_logs ALTER COLUMN template_key TYPE template_key_v11 USING template_key::text::template_key_v11;
DROP TYPE template_key;
ALTER TYPE template_key_v11 RENAME TO template_key;
ALTER TABLE communication_logs ADD CONSTRAINT communication_logs_secret_payload_check CHECK ((template_key = 'portal_login') OR (secret_payload_ciphertext IS NULL));
