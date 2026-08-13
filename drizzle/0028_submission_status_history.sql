-- Proposal decisions are reversible, but their history must not be. Capture
-- every status transition at the database boundary and let application write
-- paths attach the organizer or speaker responsible through transaction-local
-- context. Direct maintenance remains visible as a system transition.

CREATE TABLE submission_status_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  submission_id uuid NOT NULL,
  from_status submission_status,
  to_status submission_status NOT NULL,
  source text NOT NULL DEFAULT 'system'
    CHECK (source IN ('baseline', 'organizer', 'notification', 'speaker', 'system')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_contact_id uuid,
  changed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (submission_id, event_id) REFERENCES submissions(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (actor_contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE SET NULL (actor_contact_id),
  UNIQUE (id, event_id)
);

CREATE INDEX submission_status_revisions_submission_idx
  ON submission_status_revisions (event_id, submission_id, changed_at DESC);

-- Existing rows get an honest baseline, not an invented prior transition.
INSERT INTO submission_status_revisions (
  event_id, submission_id, from_status, to_status, source, changed_at
)
SELECT event_id, id, NULL, status, 'baseline', updated_at
FROM submissions;

CREATE OR REPLACE FUNCTION capture_submission_status_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_source text;
  actor_user uuid;
  actor_contact uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  revision_source := COALESCE(
    NULLIF(current_setting('openboard.submission_status_source', true), ''),
    'system'
  );
  actor_user := NULLIF(current_setting('openboard.actor_user_id', true), '')::uuid;
  actor_contact := NULLIF(current_setting('openboard.actor_contact_id', true), '')::uuid;

  INSERT INTO submission_status_revisions (
    event_id, submission_id, from_status, to_status, source,
    actor_user_id, actor_contact_id
  ) VALUES (
    NEW.event_id, NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status, revision_source, actor_user, actor_contact
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER submissions_capture_status_revision
AFTER INSERT OR UPDATE OF status ON submissions
FOR EACH ROW EXECUTE FUNCTION capture_submission_status_revision();
