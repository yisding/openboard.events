-- Vocabulary references stored in JSON/arrays do not have a native foreign
-- key. Lock the referenced rows while those writes commit so a concurrent
-- vocabulary DELETE (which takes FOR UPDATE) cannot slip between validation
-- and persistence.
CREATE OR REPLACE FUNCTION lock_vocab_option_array(p_event_id uuid, p_options jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  expected_count integer;
  locked_count integer;
BEGIN
  IF p_options IS NULL THEN RETURN; END IF;

  SELECT count(*)::integer INTO expected_count
  FROM (
    SELECT DISTINCT (option ->> 'trackId')::uuid AS id
    FROM jsonb_array_elements(p_options) AS option
    WHERE option ? 'trackId'
  ) referenced;
  SELECT count(*)::integer INTO locked_count
  FROM (
    SELECT track.id FROM tracks AS track
    WHERE track.event_id = p_event_id
      AND track.id IN (
        SELECT DISTINCT (option ->> 'trackId')::uuid
        FROM jsonb_array_elements(p_options) AS option
        WHERE option ? 'trackId'
      )
    ORDER BY track.id
    FOR KEY SHARE OF track
  ) locked;
  IF locked_count <> expected_count THEN
    RAISE EXCEPTION 'form option references a track outside this event' USING ERRCODE = '23503';
  END IF;

  SELECT count(*)::integer INTO expected_count
  FROM (
    SELECT DISTINCT (option ->> 'formatId')::uuid AS id
    FROM jsonb_array_elements(p_options) AS option
    WHERE option ? 'formatId'
  ) referenced;
  SELECT count(*)::integer INTO locked_count
  FROM (
    SELECT format.id FROM session_formats AS format
    WHERE format.event_id = p_event_id
      AND format.id IN (
        SELECT DISTINCT (option ->> 'formatId')::uuid
        FROM jsonb_array_elements(p_options) AS option
        WHERE option ? 'formatId'
      )
    ORDER BY format.id
    FOR KEY SHARE OF format
  ) locked;
  IF locked_count <> expected_count THEN
    RAISE EXCEPTION 'form option references a format outside this event' USING ERRCODE = '23503';
  END IF;

END;
$$;

CREATE OR REPLACE FUNCTION validate_form_field_vocab_options()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.deleted_at IS NULL THEN
    PERFORM lock_vocab_option_array(NEW.event_id, NEW.options);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS form_fields_vocab_options_guard ON form_fields;
CREATE TRIGGER form_fields_vocab_options_guard
BEFORE INSERT OR UPDATE OF options, deleted_at, event_id ON form_fields
FOR EACH ROW EXECUTE FUNCTION validate_form_field_vocab_options();

CREATE OR REPLACE FUNCTION lock_form_runtime_vocab(p_event_id uuid, p_form_id uuid, p_include_authoring boolean)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  option_array jsonb;
BEGIN
  IF p_include_authoring THEN
    FOR option_array IN
      SELECT COALESCE(field.options, '[]'::jsonb)
      FROM form_fields AS field
      WHERE field.event_id = p_event_id AND field.form_id = p_form_id AND field.deleted_at IS NULL
    LOOP
      PERFORM lock_vocab_option_array(p_event_id, option_array);
    END LOOP;
  END IF;

  FOR option_array IN
    SELECT COALESCE(field -> 'options', '[]'::jsonb)
    FROM form_versions AS version
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(version.snapshot -> 'sections', '[]'::jsonb)) AS section
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(section -> 'fields', '[]'::jsonb)) AS field
    WHERE version.event_id = p_event_id AND version.form_id = p_form_id
      AND version.version = (
        SELECT max(latest.version) FROM form_versions AS latest
        WHERE latest.event_id = p_event_id AND latest.form_id = p_form_id
      )
  LOOP
    PERFORM lock_vocab_option_array(p_event_id, option_array);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION validate_open_form_vocab()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'open' THEN
    PERFORM lock_form_runtime_vocab(NEW.event_id, NEW.id, true);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS forms_open_vocab_guard ON forms;
CREATE TRIGGER forms_open_vocab_guard
BEFORE INSERT OR UPDATE OF status ON forms
FOR EACH ROW EXECUTE FUNCTION validate_open_form_vocab();

CREATE OR REPLACE FUNCTION validate_active_task_form_vocab()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_active AND NEW.form_id IS NOT NULL THEN
    PERFORM lock_form_runtime_vocab(NEW.event_id, NEW.form_id, false);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS portal_tasks_form_vocab_guard ON portal_tasks;
CREATE TRIGGER portal_tasks_form_vocab_guard
BEFORE INSERT OR UPDATE OF is_active, form_id ON portal_tasks
FOR EACH ROW EXECUTE FUNCTION validate_active_task_form_vocab();

CREATE OR REPLACE FUNCTION validate_runtime_form_version_vocab()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  runtime boolean;
  option_array jsonb;
BEGIN
  SELECT form.status = 'open' OR EXISTS (
    SELECT 1 FROM portal_tasks AS task
    WHERE task.event_id = NEW.event_id AND task.form_id = NEW.form_id AND task.is_active
  ) INTO runtime
  FROM forms AS form
  WHERE form.event_id = NEW.event_id AND form.id = NEW.form_id;
  IF NOT COALESCE(runtime, false) THEN RETURN NEW; END IF;

  FOR option_array IN
    SELECT COALESCE(field -> 'options', '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(NEW.snapshot -> 'sections', '[]'::jsonb)) AS section
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(section -> 'fields', '[]'::jsonb)) AS field
  LOOP
    PERFORM lock_vocab_option_array(NEW.event_id, option_array);
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS form_versions_runtime_vocab_guard ON form_versions;
CREATE TRIGGER form_versions_runtime_vocab_guard
BEFORE INSERT OR UPDATE OF snapshot ON form_versions
FOR EACH ROW EXECUTE FUNCTION validate_runtime_form_version_vocab();

-- Replace the existing M19/M50 validation with the same locking guarantee.
-- NULL continues to mean "all tracks" and therefore names no specific track.
CREATE OR REPLACE FUNCTION validate_track_scope_array()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_count integer;
  locked_count integer;
BEGIN
  IF NEW.track_ids IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(DISTINCT id)::integer INTO expected_count FROM unnest(NEW.track_ids) AS id;
  SELECT count(*)::integer INTO locked_count
  FROM (
    SELECT track.id FROM tracks AS track
    WHERE track.event_id = NEW.event_id
      AND track.id = ANY(NEW.track_ids)
    ORDER BY track.id
    FOR KEY SHARE OF track
  ) locked;
  IF locked_count <> expected_count THEN
    RAISE EXCEPTION 'track scope contains a track outside this event' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
