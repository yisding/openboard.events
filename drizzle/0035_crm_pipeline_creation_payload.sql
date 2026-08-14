-- A pipeline row's live contact and target event are intentionally mutable:
-- contact merge rewrites organization_contact_id, and deleting an event sets
-- target_event_id to NULL. Preserve the insert-time request separately so an
-- organizer can replay a frozen response-loss attempt after either lifecycle
-- operation without creating a duplicate or receiving a false conflict.
ALTER TABLE organization_contact_pipeline
  ADD COLUMN creation_payload jsonb;

-- Existing rows predate caller-supplied creation ids, so their current values
-- are the only truthful snapshot available. New writes are captured by the
-- insert trigger below, including writes from an older app instance during a
-- rolling deployment that does not yet know about creation_payload.
UPDATE organization_contact_pipeline
SET creation_payload = jsonb_build_object(
  'organizationContactId', organization_contact_id::text,
  'targetEventId', CASE WHEN target_event_id IS NULL THEN NULL ELSE to_jsonb(target_event_id::text) END,
  'notes', CASE WHEN notes IS NULL THEN NULL ELSE to_jsonb(notes) END
);

CREATE FUNCTION capture_crm_pipeline_creation_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.creation_payload IS NULL THEN
    NEW.creation_payload := jsonb_build_object(
      'organizationContactId', NEW.organization_contact_id::text,
      'targetEventId', CASE WHEN NEW.target_event_id IS NULL THEN NULL ELSE to_jsonb(NEW.target_event_id::text) END,
      'notes', CASE WHEN NEW.notes IS NULL THEN NULL ELSE to_jsonb(NEW.notes) END
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_contact_pipeline_capture_creation_payload
BEFORE INSERT ON organization_contact_pipeline
FOR EACH ROW EXECUTE FUNCTION capture_crm_pipeline_creation_payload();

CREATE FUNCTION guard_crm_pipeline_creation_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.creation_payload IS DISTINCT FROM OLD.creation_payload THEN
    RAISE EXCEPTION 'organization_contact_pipeline.creation_payload is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_contact_pipeline_guard_creation_payload
BEFORE UPDATE OF creation_payload ON organization_contact_pipeline
FOR EACH ROW EXECUTE FUNCTION guard_crm_pipeline_creation_payload();

ALTER TABLE organization_contact_pipeline
  ALTER COLUMN creation_payload SET NOT NULL,
  ADD CONSTRAINT organization_contact_pipeline_creation_payload_shape_ck CHECK (
    jsonb_typeof(creation_payload) = 'object'
    AND creation_payload ? 'organizationContactId'
    AND creation_payload ? 'targetEventId'
    AND creation_payload ? 'notes'
    AND jsonb_typeof(creation_payload -> 'organizationContactId') = 'string'
    AND jsonb_typeof(creation_payload -> 'targetEventId') IN ('string', 'null')
    AND jsonb_typeof(creation_payload -> 'notes') IN ('string', 'null')
  );
