-- Reviewer onboarding must not depend on an organizer choosing and sharing a
-- password. Reuse the existing email-bound organization invitation credential,
-- but let a pending invitation optionally target one event. Acceptance then
-- grants both the organization membership needed to see the workspace and the
-- explicit event membership needed to enter the review queue.

-- Established fallback accounts predate mandatory mailbox verification. Their
-- hash and credential timestamps can both be modern after a reset or operator
-- provisioning, so identify self-service provenance by its durable signup
-- consent record instead. Every self-service account records that evidence in
-- the user-create hook; established/bootstrap/reviewer accounts do not.
UPDATE users AS established_user
SET email_verified = true
WHERE established_user.email_verified = false
  AND EXISTS (
    SELECT 1
    FROM admin_accounts AS credential
    WHERE credential.user_id = established_user.id
      AND credential.provider_id = 'credential'
      AND credential.password IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM user_legal_acceptances AS acceptance
    WHERE acceptance.user_id = established_user.id
      AND acceptance.source = 'signup'
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
