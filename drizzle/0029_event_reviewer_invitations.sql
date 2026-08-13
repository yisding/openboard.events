-- Reviewer onboarding must not depend on an organizer choosing and sharing a
-- password. Reuse the existing email-bound organization invitation credential,
-- but let a pending invitation optionally target one event. Acceptance then
-- grants both the organization membership needed to see the workspace and the
-- explicit event membership needed to enter the review queue.

-- Accounts established outside self-service predate both mandatory email
-- verification and signup-consent evidence. Their password may already be v2
-- after a Better Auth reset, so provenance—not hash version—is the safe
-- distinction. New self-service accounts always record a signup acceptance and
-- remain unverified until their email link is used.
UPDATE users AS established_user
SET email_verified = true
WHERE established_user.email_verified = false
  AND established_user.password_hash IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM user_legal_acceptances acceptance
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
