-- MTP-07 §2 step 14 — "prior placements are recorded with who and when".
--
-- The content half of a session's history already exists
-- (`session_content_revisions`, drizzle/0006); nothing recorded the other half,
-- so every drag, dialog reschedule and Auto-place apply left no trace at all.
--
-- Room *names*, not room ids: a placement record is an account of what happened,
-- and an `ON DELETE SET NULL` room reference would let deleting a room quietly
-- rewrite the history of every session it ever held. The times are stored as
-- nullable pairs so "moved back to the unscheduled tray" is representable and
-- reads honestly on both sides.
CREATE TABLE session_placement_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  from_starts_at timestamptz,
  from_ends_at timestamptz,
  from_room_name text,
  to_starts_at timestamptz,
  to_ends_at timestamptz,
  to_room_name text,
  moved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, event_id) REFERENCES sessions(id, event_id) ON DELETE CASCADE
);
CREATE INDEX session_placement_revisions_session_idx ON session_placement_revisions (session_id, created_at DESC);
