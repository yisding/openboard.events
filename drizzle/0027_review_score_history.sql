-- An editable review still needs an immutable explanation of how it changed.
-- The current `reviews` row remains the scoring source of truth; this table is
-- its append-only history, captured at the database boundary so API retries,
-- future write paths, and direct maintenance cannot silently skip the audit.

CREATE TABLE review_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  review_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL,
  revision integer NOT NULL,
  overall_score numeric,
  criterion_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  criteria_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_ai boolean NOT NULL DEFAULT false,
  comment text,
  submitted_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (review_id, event_id) REFERENCES reviews(id, event_id) ON DELETE CASCADE,
  UNIQUE (review_id, revision),
  UNIQUE (id, event_id)
);

CREATE INDEX review_revisions_submission_idx
  ON review_revisions (event_id, submission_id, recorded_at DESC);

-- Preserve the current state of every review that predates history support.
INSERT INTO review_revisions (
  event_id, review_id, plan_id, submission_id, reviewer_user_id, revision,
  overall_score, criterion_scores, criteria_snapshot, is_ai, comment, submitted_at,
  recorded_at
)
SELECT
  r.event_id, r.id, r.plan_id, r.submission_id, r.reviewer_user_id, 1,
  r.overall_score, r.criterion_scores,
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', c.id,
      'label', c.label,
      'options', c.options
    ) ORDER BY c.sort_order, c.label)
    FROM evaluation_criteria c
    WHERE c.plan_id = r.plan_id AND c.event_id = r.event_id
  ), '[]'::jsonb),
  r.is_ai, r.comment, r.submitted_at, r.updated_at
FROM reviews r;

CREATE OR REPLACE FUNCTION capture_review_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  next_revision integer;
  criterion_snapshot jsonb;
BEGIN
  -- An exact re-save is idempotent, not a new historical verdict.
  IF TG_OP = 'UPDATE' AND ROW(
    OLD.overall_score, OLD.criterion_scores, OLD.is_ai, OLD.comment, OLD.submitted_at
  ) IS NOT DISTINCT FROM ROW(
    NEW.overall_score, NEW.criterion_scores, NEW.is_ai, NEW.comment, NEW.submitted_at
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(max(rr.revision), 0) + 1
  INTO next_revision
  FROM review_revisions rr
  WHERE rr.review_id = NEW.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'label', c.label,
    'options', c.options
  ) ORDER BY c.sort_order, c.label), '[]'::jsonb)
  INTO criterion_snapshot
  FROM evaluation_criteria c
  WHERE c.plan_id = NEW.plan_id AND c.event_id = NEW.event_id;

  INSERT INTO review_revisions (
    event_id, review_id, plan_id, submission_id, reviewer_user_id, revision,
    overall_score, criterion_scores, criteria_snapshot, is_ai, comment, submitted_at
  ) VALUES (
    NEW.event_id, NEW.id, NEW.plan_id, NEW.submission_id,
    NEW.reviewer_user_id, next_revision, NEW.overall_score,
    NEW.criterion_scores, criterion_snapshot, NEW.is_ai, NEW.comment, NEW.submitted_at
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER reviews_capture_revision
AFTER INSERT OR UPDATE OF overall_score, criterion_scores, is_ai, comment, submitted_at
ON reviews FOR EACH ROW EXECUTE FUNCTION capture_review_revision();
