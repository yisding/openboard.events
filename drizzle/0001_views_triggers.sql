CREATE OR REPLACE FUNCTION guard_submission_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (CASE OLD.status
    WHEN 'draft' THEN NEW.status IN ('pending','withdrawn')
    WHEN 'pending' THEN NEW.status IN ('accept_queue','decline_queue','accepted','declined','withdrawn')
    WHEN 'accept_queue' THEN NEW.status IN ('pending','decline_queue','accepted','declined','withdrawn')
    WHEN 'decline_queue' THEN NEW.status IN ('pending','accept_queue','accepted','declined','withdrawn')
    WHEN 'accepted' THEN NEW.status IN ('pending','accept_queue','decline_queue','declined','withdrawn')
    WHEN 'declined' THEN NEW.status IN ('pending','accept_queue','decline_queue','accepted')
    WHEN 'withdrawn' THEN NEW.status IN ('pending')
  END) THEN
    RAISE EXCEPTION 'illegal submission transition % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  -- Reversing a finalized decision bumps notify_revision atomically so a
  -- fresh decision can notify again without reusing the old idempotency key.
  IF OLD.status IN ('accepted','declined') AND NEW.status='pending' THEN NEW.notify_revision=OLD.notify_revision+1; END IF;
  NEW.row_version=OLD.row_version+1; NEW.updated_at=now(); RETURN NEW;
END $$;
CREATE TRIGGER submissions_transition_guard BEFORE UPDATE OF status ON submissions FOR EACH ROW EXECUTE FUNCTION guard_submission_transition();

CREATE VIEW accepted_speakers_v AS
SELECT DISTINCT c.* FROM contacts c JOIN submission_participants sp ON sp.contact_id=c.id JOIN submissions s ON s.id=sp.submission_id WHERE s.status='accepted';

CREATE VIEW task_assignments_v AS
SELECT t.id task_id,c.id contact_id,NULL::uuid submission_id,t.due_at
FROM portal_tasks t JOIN accepted_speakers_v c ON c.event_id=t.event_id WHERE t.active AND t.target='contact'
UNION ALL
SELECT t.id,sp.contact_id,s.id,t.due_at
FROM portal_tasks t JOIN submissions s ON s.event_id=t.event_id AND s.status='accepted' JOIN submission_participants sp ON sp.submission_id=s.id AND sp.is_primary WHERE t.active AND t.target='submission';

CREATE VIEW speaker_outstanding_v AS
SELECT a.contact_id,count(*) outstanding_count,count(*) FILTER(WHERE a.due_at<now()) overdue_count
FROM task_assignments_v a LEFT JOIN task_completions c ON c.task_id=a.task_id AND c.contact_id=a.contact_id AND c.submission_id IS NOT DISTINCT FROM a.submission_id
WHERE c.task_id IS NULL GROUP BY a.contact_id;

CREATE VIEW submission_status_counts_v AS SELECT event_id,status,count(*) count FROM submissions WHERE status<>'draft' GROUP BY event_id,status;
CREATE VIEW submission_ratings_v AS SELECT submission_id,avg(score)::numeric(4,2) rating,count(*) review_count FROM reviews GROUP BY submission_id;
CREATE VIEW published_sessions_v AS SELECT s.*,r.name room_name,t.name track_name FROM sessions s LEFT JOIN rooms r ON r.id=s.room_id LEFT JOIN tracks t ON t.id=s.track_id WHERE s.status='published' AND s.starts_at IS NOT NULL;
CREATE VIEW published_speakers_v AS SELECT DISTINCT c.* FROM contacts c JOIN session_speakers ss ON ss.contact_id=c.id JOIN published_sessions_v s ON s.id=ss.session_id WHERE c.confirmation_status='confirmed';
