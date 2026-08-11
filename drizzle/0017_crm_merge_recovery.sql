-- M55 follow-up: keep merge audits immutable while recording an explicit,
-- organization-scoped recovery receipt. The merge audit itself remains the
-- source of truth for the compare-and-restore snapshot.

CREATE TABLE organization_contact_merge_recoveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  merge_id uuid NOT NULL REFERENCES organization_contact_merges(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reference_counts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merge_id)
);
CREATE INDEX organization_contact_merge_recoveries_org_idx
  ON organization_contact_merge_recoveries(organization_id, created_at);
