-- A self-serve owner must be able to resume setup after a refresh, sign-out,
-- or lost mutation response. Existing events have no row and are therefore
-- complete by definition; only the organization onboarding composition
-- creates one of these checkpoints. Completed rows remain as inert tombstones
-- so a delayed stable-id event-create replay cannot restart the wizard.

CREATE TABLE event_onboarding_progress (
  event_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Reserved before the form INSERT so a committed-but-lost create response
  -- can be recovered with the same client-generated ID.
  form_id uuid,
  step text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_onboarding_progress_step_ck
    CHECK (step IN ('vocabulary', 'form', 'complete')),
  CONSTRAINT event_onboarding_progress_event_org_fk
    FOREIGN KEY (event_id, organization_id)
    REFERENCES events(id, organization_id)
    ON DELETE CASCADE
);

CREATE INDEX event_onboarding_progress_org_updated_idx
  ON event_onboarding_progress (organization_id, updated_at);
