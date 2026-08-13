-- Reviewer onboarding must not depend on an organizer choosing and sharing a
-- password. Reuse the existing email-bound organization invitation credential,
-- but let a pending invitation optionally target one event. Acceptance then
-- grants both the organization membership needed to see the workspace and the
-- explicit event membership needed to enter the review queue.

-- Established fallback accounts predate mandatory mailbox verification. Their
-- hash and credential timestamps can both be modern after a reset or operator
-- provisioning, so record account provenance explicitly. A separate table
-- keeps older partial-migration consumers of the shared `users` schema
-- compatible. The trigger fails closed for every account created after this
-- migration, including during a rolling deploy before the new app is serving;
-- trusted operator paths explicitly remove their marker.
CREATE TABLE self_service_signups (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- M44's signup hook has exactly two immediate outcomes: create an organization
-- with the new user as owner, or accept an invitation. Those structural facts
-- predate both the optional legal-consent table and the onboarding analytics
-- table, so they are the durable way to identify every earlier self-service
-- signup without making either later module a migration prerequisite.
WITH signup_evidence AS (
  SELECT member.user_id, min(organization.created_at) AS signup_at
  FROM organization_members AS member
  JOIN organizations AS organization ON organization.id = member.organization_id
  JOIN users AS account ON account.id = member.user_id
  WHERE organization.id <> 'd3fa0000-0000-4000-8000-000000000001'::uuid
    AND organization.created_at BETWEEN account.created_at - interval '1 minute'
      AND account.created_at + interval '15 minutes'
  GROUP BY member.user_id

  UNION ALL

  SELECT invitation.accepted_user_id AS user_id, min(invitation.accepted_at) AS signup_at
  FROM organization_invitations AS invitation
  JOIN users AS account ON account.id = invitation.accepted_user_id
  WHERE invitation.accepted_user_id IS NOT NULL
    AND invitation.accepted_at BETWEEN account.created_at - interval '1 minute'
      AND account.created_at + interval '15 minutes'
  GROUP BY invitation.accepted_user_id
), earliest_signup AS (
  SELECT user_id, min(signup_at) AS signup_at
  FROM signup_evidence
  GROUP BY user_id
)
INSERT INTO self_service_signups(user_id, created_at)
SELECT user_id, signup_at
FROM earliest_signup
ON CONFLICT (user_id) DO NOTHING;

-- Later modules provide additional evidence for personal workspaces whose
-- original owner has since left, and for signups that recorded legal consent.
-- Dynamic SQL keeps these optional tables supplemental: 0029 still applies in
-- focused/partial deployments that intentionally stop before either module.
DO $$
BEGIN
  IF to_regclass('public.organization_onboarding_milestones') IS NOT NULL THEN
    EXECUTE 'INSERT INTO self_service_signups(user_id, created_at)
      SELECT actor_user_id, occurred_at
      FROM organization_onboarding_milestones
      WHERE milestone = ''signup_completed'' AND actor_user_id IS NOT NULL
      ON CONFLICT (user_id) DO NOTHING';
  END IF;
  IF to_regclass('public.user_legal_acceptances') IS NOT NULL THEN
    EXECUTE 'INSERT INTO self_service_signups(user_id, created_at)
      SELECT user_id, min(accepted_at)
      FROM user_legal_acceptances
      WHERE source = ''signup''
      GROUP BY user_id
      ON CONFLICT (user_id) DO NOTHING';
  END IF;
END;
$$;

CREATE FUNCTION mark_new_user_as_self_service()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO self_service_signups(user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_mark_new_self_service_signup
AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION mark_new_user_as_self_service();

UPDATE users AS established_user
SET email_verified = true
WHERE established_user.email_verified = false
  AND NOT EXISTS (
    SELECT 1
    FROM self_service_signups AS signup
    WHERE signup.user_id = established_user.id
  )
  AND EXISTS (
    SELECT 1
    FROM admin_accounts AS credential
    WHERE credential.user_id = established_user.id
      AND credential.provider_id = 'credential'
      AND credential.password IS NOT NULL
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
