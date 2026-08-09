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
  IF OLD.status = 'draft' AND NEW.submitted_at IS NULL THEN NEW.submitted_at := now(); END IF;
  IF NEW.status = 'withdrawn' AND NEW.withdrawn_at IS NULL THEN NEW.withdrawn_at := now(); END IF;
  IF NEW.status IN ('accept_queue','decline_queue','accepted','declined') AND NEW.decided_at IS NULL THEN NEW.decided_at := now(); END IF;
  IF OLD.status IN ('accepted','declined') AND NEW.status NOT IN ('accepted','declined') THEN
    NEW.notified_at := NULL;
    NEW.notify_revision := OLD.notify_revision + 1;
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER submissions_transition_guard BEFORE UPDATE OF status ON submissions FOR EACH ROW EXECUTE FUNCTION guard_submission_transition();

CREATE FUNCTION is_form_open(p_form_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT f.status = 'open'
    AND (f.opens_at IS NULL OR f.opens_at <= now())
    AND (f.closes_at IS NULL OR f.closes_at > now())
  FROM forms f WHERE f.id = p_form_id;
$$;

CREATE VIEW accepted_speakers_v AS
SELECT sp.event_id, sp.contact_id, max(s.updated_at) AS updated_at
FROM submission_participants sp
JOIN submissions s ON s.id=sp.submission_id AND s.event_id=sp.event_id
WHERE s.status='accepted'
GROUP BY sp.event_id,sp.contact_id;

-- Submission-targeted tasks assign to the primary contact only, once per
-- accepted submission; contact-targeted tasks assign to accepted_speakers_v.
CREATE VIEW task_assignments_v AS
WITH targets AS (
  SELECT t.id AS task_id,t.event_id,a.contact_id,NULL::uuid AS submission_id,t.due_at,greatest(t.updated_at,a.updated_at) AS target_updated_at
  FROM portal_tasks t JOIN accepted_speakers_v a ON a.event_id=t.event_id
  WHERE t.target_type='contact' AND t.is_active
  UNION ALL
  SELECT t.id,t.event_id,sp.contact_id,s.id,t.due_at,greatest(t.updated_at,s.updated_at)
  FROM portal_tasks t
  JOIN submissions s ON s.event_id=t.event_id AND s.status='accepted'
  JOIN submission_participants sp ON sp.submission_id=s.id AND sp.event_id=s.event_id AND sp.is_primary
  WHERE t.target_type='submission' AND t.is_active
)
SELECT tg.task_id,tg.event_id,tg.contact_id,tg.submission_id,tg.due_at,
  (tc.id IS NOT NULL) AS completed,tc.completed_at,tc.completed_via,
  (tc.id IS NULL AND tg.due_at IS NOT NULL AND tg.due_at<now()) AS overdue,
  greatest(tg.target_updated_at,coalesce(tc.completed_at,'epoch'::timestamptz)) AS updated_at
FROM targets tg
LEFT JOIN task_completions tc ON tc.task_id=tg.task_id AND tc.contact_id=tg.contact_id
  AND tc.submission_id IS NOT DISTINCT FROM tg.submission_id;

CREATE VIEW speaker_outstanding_v AS
SELECT event_id,contact_id,
  count(*) FILTER(WHERE NOT completed) AS open_count,
  count(*) FILTER(WHERE overdue) AS overdue_count,
  count(*) FILTER(WHERE completed) AS done_count,
  max(updated_at) AS updated_at
FROM task_assignments_v GROUP BY event_id,contact_id;

CREATE VIEW missing_assets_v AS
SELECT c.event_id,c.id AS contact_id,
  (c.bio_html IS NULL OR btrim(regexp_replace(c.bio_html,'<[^>]*>','','g'))='') AS missing_bio,
  (c.headshot_file_id IS NULL) AS missing_headshot,
  greatest(c.updated_at,a.updated_at) AS updated_at
FROM contacts c JOIN accepted_speakers_v a ON a.event_id=c.event_id AND a.contact_id=c.id;

CREATE VIEW submission_status_counts_v AS
SELECT event_id,status,count(*) AS n,max(updated_at) AS updated_at FROM submissions GROUP BY event_id,status;
-- Submissions KPI = sum where status <> 'draft'; tabs show per-status n; All = sum(all).

CREATE VIEW submission_ratings_v AS
SELECT event_id,submission_id,plan_id,avg(overall_score) AS rating,count(overall_score) AS n_scores,max(updated_at) AS updated_at
FROM reviews WHERE overall_score IS NOT NULL GROUP BY event_id,submission_id,plan_id;

CREATE VIEW published_sessions_v AS
SELECT s.id,s.event_id,s.title,s.slug,s.description_html,s.starts_at,s.ends_at,
  s.track_id,t.name AS track_name,t.color AS track_color,s.room_id,r.name AS room_name,
  s.format_id,f.name AS format_name,
  greatest(s.updated_at,coalesce(t.updated_at,'epoch'::timestamptz),coalesce(r.updated_at,'epoch'::timestamptz),coalesce(f.updated_at,'epoch'::timestamptz)) AS updated_at
FROM sessions s
LEFT JOIN tracks t ON t.id=s.track_id AND t.event_id=s.event_id
LEFT JOIN rooms r ON r.id=s.room_id AND r.event_id=s.event_id
LEFT JOIN session_formats f ON f.id=s.format_id AND f.event_id=s.event_id
WHERE s.status='published' AND s.starts_at IS NOT NULL;

CREATE VIEW published_speakers_v AS
SELECT c.event_id,c.id AS contact_id,c.first_name,c.last_name,c.job_title,c.company,c.bio_html,c.headshot_file_id,
  c.linkedin_url,c.twitter_url,c.website_url,greatest(c.updated_at,max(s.updated_at)) AS updated_at
FROM contacts c
JOIN session_speakers ss ON ss.contact_id=c.id AND ss.event_id=c.event_id
JOIN sessions s ON s.id=ss.session_id AND s.event_id=ss.event_id AND s.status='published'
WHERE c.confirmation_status='confirmed'
GROUP BY c.event_id,c.id,c.first_name,c.last_name,c.job_title,c.company,c.bio_html,c.headshot_file_id,c.linkedin_url,c.twitter_url,c.website_url,c.updated_at;
