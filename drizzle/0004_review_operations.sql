-- M50 — review operations depth.
--
-- Additive throughout: every new column carries a default that reproduces the
-- behaviour merged for M19, so an existing database keeps working before any
-- organizer touches a round. Nothing here rewrites an applied migration and no
-- score store is created — `reviews` and `submission_ratings_v` remain the only
-- score and aggregate truth.

CREATE TYPE criterion_kind AS ENUM ('numeric', 'select', 'text');
CREATE TYPE review_visibility AS ENUM ('content', 'identity');
CREATE TYPE review_assignment_status AS ENUM ('assigned', 'recused');

-- Appended labels only. `ALTER TYPE … ADD VALUE` is legal inside the migration
-- transaction on PostgreSQL 12+ as long as the new label is not *used* in the
-- same transaction — nothing below writes one, and the per-event template rows
-- are seeded at runtime by `seedDefaultTemplates`.
ALTER TYPE template_key ADD VALUE IF NOT EXISTS 'reviewer_invited';
ALTER TYPE template_key ADD VALUE IF NOT EXISTS 'review_reminder';

-- Round governance. The window is half-open: reviewers may save while
-- `opens_at <= now < closes_at`. NULL on either side means "unbounded on that
-- side", which is exactly what every M19 round already was.
ALTER TABLE evaluation_plans
  ADD COLUMN opens_at timestamptz,
  ADD COLUMN closes_at timestamptz,
  ADD COLUMN anonymize_authors boolean NOT NULL DEFAULT false;
ALTER TABLE evaluation_plans
  ADD CONSTRAINT evaluation_plans_window_ck
  CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at);

-- Typed criteria. `kind='numeric'` and `required=true` reproduce M19, whose
-- weighted mean already refused to produce a number until every criterion was
-- scored. Bounds are NULL by default and fall back to the plan's scale.
ALTER TABLE evaluation_criteria
  ADD COLUMN kind criterion_kind NOT NULL DEFAULT 'numeric',
  ADD COLUMN required boolean NOT NULL DEFAULT true,
  ADD COLUMN options jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN min_value numeric,
  ADD COLUMN max_value numeric;
ALTER TABLE evaluation_criteria
  ADD CONSTRAINT evaluation_criteria_bounds_ck
  CHECK (min_value IS NULL OR max_value IS NULL OR max_value > min_value);

-- Blind review classification, pinned into every future form snapshot.
-- `identity` is the default, so an organizer must deliberately opt a question
-- into a blind reviewer's view; locked contact fields can never be opted in.
ALTER TABLE form_fields
  ADD COLUMN review_visibility review_visibility NOT NULL DEFAULT 'identity';

-- Explicit assignments. This is the reviewer queue's authority from here on;
-- `reviewer_assignments.track_ids` stays as the *candidate* filter organizers
-- use to pick who gets what.
CREATE TABLE review_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES evaluation_plans(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status review_assignment_status NOT NULL DEFAULT 'assigned',
  recusal_reason text,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  recused_at timestamptz,
  last_reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_assignments_natural_key UNIQUE (plan_id, submission_id, reviewer_user_id),
  CONSTRAINT review_assignments_id_event_key UNIQUE (id, event_id),
  -- A recusal without a time is unauditable, and a time without a recusal is a
  -- lie; the two move together or not at all.
  CONSTRAINT review_assignments_recusal_ck CHECK ((status = 'recused') = (recused_at IS NOT NULL))
);
CREATE INDEX review_assignments_reviewer_idx
  ON review_assignments (event_id, reviewer_user_id, plan_id);
CREATE INDEX review_assignments_plan_idx
  ON review_assignments (event_id, plan_id, status);

-- Backfill 1: everything an M19 reviewer could already see becomes an explicit
-- assignment, so switching the queue's authority to this table does not empty
-- anybody's worklist on deploy.
INSERT INTO review_assignments (event_id, plan_id, submission_id, reviewer_user_id)
SELECT p.event_id, p.id, s.id, a.user_id
FROM evaluation_plans p
JOIN reviewer_assignments a ON a.plan_id = p.id AND a.event_id = p.event_id
JOIN submissions s ON s.event_id = p.event_id
WHERE s.status NOT IN ('draft', 'withdrawn')
  AND (p.track_ids IS NULL OR s.track_id = ANY(p.track_ids))
  AND (a.track_ids IS NULL OR s.track_id = ANY(a.track_ids))
ON CONFLICT ON CONSTRAINT review_assignments_natural_key DO NOTHING;

-- Backfill 2: a review that exists is proof the work was assigned, whatever the
-- track scope says today.
INSERT INTO review_assignments (event_id, plan_id, submission_id, reviewer_user_id)
SELECT DISTINCT r.event_id, r.plan_id, r.submission_id, r.reviewer_user_id
FROM reviews r
ON CONFLICT ON CONSTRAINT review_assignments_natural_key DO NOTHING;

-- Evolve the existing payload in place: `{"<criterionId>": 4}` becomes
-- `{"<criterionId>": {"kind":"numeric","value":4}}`. Non-numeric leaves are
-- dropped rather than guessed at; there were none before this migration.
UPDATE reviews SET criterion_scores = COALESCE((
  SELECT jsonb_object_agg(entry.key, jsonb_build_object('kind', 'numeric', 'value', entry.value))
  FROM jsonb_each(reviews.criterion_scores) AS entry
  WHERE jsonb_typeof(entry.value) = 'number'
), '{}'::jsonb)
WHERE EXISTS (
  SELECT 1 FROM jsonb_each(reviews.criterion_scores) AS entry
  WHERE jsonb_typeof(entry.value) = 'number'
);
