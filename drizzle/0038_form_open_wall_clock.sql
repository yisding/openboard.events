-- Submission transactions can wait on a speaker/form limit guard. PostgreSQL's
-- now() is fixed at transaction start, so it can report a form as open after
-- the wall-clock deadline has passed. Evaluate availability at the statement's
-- actual wall-clock instant instead.
CREATE OR REPLACE FUNCTION is_form_open(p_form_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE AS $$
  SELECT coalesce((
    SELECT f.status = 'open'
      AND (f.opens_at IS NULL OR f.opens_at <= clock_timestamp())
      AND (f.closes_at IS NULL OR f.closes_at > clock_timestamp())
    FROM forms f WHERE f.id = p_form_id
  ), false);
$$;
