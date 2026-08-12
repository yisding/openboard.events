-- Privacy-safe, first-occurrence signals for the self-service funnel. This is
-- deliberately not a general analytics event stream: there is one row per
-- organization/milestone, no email, IP address, user agent, URL, or arbitrary
-- metadata, and deleting the organization removes the complete funnel record.

CREATE TABLE organization_onboarding_milestones (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  milestone text NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, milestone),
  CONSTRAINT organization_onboarding_milestones_name_ck CHECK (milestone IN (
    'signup_completed',
    'email_verified',
    'event_created',
    'form_published',
    'public_form_visited'
  ))
);

CREATE INDEX organization_onboarding_milestones_funnel_idx
  ON organization_onboarding_milestones (milestone, occurred_at);
