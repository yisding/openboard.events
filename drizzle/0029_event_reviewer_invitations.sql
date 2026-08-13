-- Reviewer onboarding must not depend on an organizer choosing and sharing a
-- password. Reuse the existing email-bound organization invitation credential,
-- but let a pending invitation optionally target one event. Acceptance then
-- grants both the organization membership needed to see the workspace and the
-- explicit event membership needed to enter the review queue.

-- Fallback accounts created before self-service signup predate email
-- verification. Identify them by migration provenance rather than their
-- current hash: 0009 backfilled their credential rows before 0010 created the
-- default organization, and a later rehash or password reset preserves the
-- credential row's created_at. New self-service credentials are necessarily
-- newer than that marker and must still verify their mailbox.
UPDATE users AS legacy_user
SET email_verified = true
WHERE legacy_user.email_verified = false
  AND EXISTS (
    SELECT 1
    FROM admin_accounts AS legacy_account
    JOIN organizations AS migration_marker
      ON migration_marker.id = 'd3fa0000-0000-4000-8000-000000000001'::uuid
    WHERE legacy_account.user_id = legacy_user.id
      AND legacy_account.provider_id = 'credential'
      AND legacy_account.created_at <= migration_marker.created_at
  );

ALTER TABLE organization_invitations
  ADD COLUMN event_id uuid;

ALTER TABLE organization_invitations
  ADD CONSTRAINT organization_invitations_event_organization_fk
  FOREIGN KEY (event_id, organization_id)
  REFERENCES events(id, organization_id)
  ON DELETE CASCADE;

ALTER TABLE organization_invitations
  ADD CONSTRAINT organization_invitations_event_reviewer_ck
  CHECK (event_id IS NULL OR role = 'reviewer');

-- A general workspace invitation (NULL event_id) and invitations to separate
-- events are distinct credentials. NULLS NOT DISTINCT keeps "invite again"
-- retry-safe for the general workspace case as well.
DROP INDEX organization_invitations_pending_email_idx;
CREATE UNIQUE INDEX organization_invitations_pending_target_idx
  ON organization_invitations(organization_id, email, event_id) NULLS NOT DISTINCT
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX organization_invitations_event_idx
  ON organization_invitations(event_id, created_at DESC)
  WHERE event_id IS NOT NULL;
