-- Phase one of removing the event-wide final-submit mutex. This sparse table
-- gives every (event, form, submitter) cap invariant its own lockable row.
-- Application instances first acquire this guard alongside the legacy event
-- lock; after that version is fully deployed, the event lock can be removed
-- without a mixed-version cap race.
CREATE TABLE submission_limit_guards (
  event_id uuid NOT NULL,
  form_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, form_id, contact_id),
  FOREIGN KEY (form_id, event_id) REFERENCES forms(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE CASCADE
);
