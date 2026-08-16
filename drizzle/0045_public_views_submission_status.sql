-- The public firewall lives in these two views, so the submission's own status
-- has to be part of it. A session promoted from an abstract kept its published
-- row (and its speaker) on every public surface after the organizer reversed
-- the decision to `declined`, or after the speaker withdrew — `submissions` is
-- the only table those writes touch, and nothing cascaded from it.
--
-- Sessions created straight in the agenda (keynotes, breaks, sponsor slots)
-- carry no `submission_id` and must stay public, hence the NULL arm.

CREATE OR REPLACE VIEW published_sessions_v AS
SELECT s.id,s.event_id,s.title,s.slug,s.description_html,s.starts_at,s.ends_at,
  s.track_id,t.name AS track_name,t.color AS track_color,s.room_id,r.name AS room_name,
  s.format_id,f.name AS format_name,
  greatest(s.updated_at,coalesce(t.updated_at,'epoch'::timestamptz),coalesce(r.updated_at,'epoch'::timestamptz),coalesce(f.updated_at,'epoch'::timestamptz)) AS updated_at,
  s.schedule_revision
FROM sessions s
LEFT JOIN tracks t ON t.id=s.track_id AND t.event_id=s.event_id
LEFT JOIN rooms r ON r.id=s.room_id AND r.event_id=s.event_id
LEFT JOIN session_formats f ON f.id=s.format_id AND f.event_id=s.event_id
WHERE s.status='published' AND s.starts_at IS NOT NULL
  AND (s.submission_id IS NULL OR EXISTS (
    SELECT 1 FROM submissions sub
    WHERE sub.id=s.submission_id AND sub.event_id=s.event_id AND sub.status='accepted'));

-- Joining the sessions view instead of `sessions` inherits that guard, so a
-- withdrawn abstract's speaker leaves the gallery with its session.
CREATE OR REPLACE VIEW published_speakers_v AS
SELECT c.event_id,c.id AS contact_id,c.first_name,c.last_name,c.job_title,c.company,c.bio_html,c.headshot_file_id,
  c.linkedin_url,c.twitter_url,c.website_url,greatest(c.updated_at,max(s.updated_at)) AS updated_at
FROM contacts c
JOIN session_speakers ss ON ss.contact_id=c.id AND ss.event_id=c.event_id
JOIN published_sessions_v s ON s.id=ss.session_id AND s.event_id=ss.event_id
WHERE c.confirmation_status='confirmed'
GROUP BY c.event_id,c.id,c.first_name,c.last_name,c.job_title,c.company,c.bio_html,c.headshot_file_id,c.linkedin_url,c.twitter_url,c.website_url,c.updated_at;
