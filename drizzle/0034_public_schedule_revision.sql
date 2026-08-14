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
WHERE s.status='published' AND s.starts_at IS NOT NULL;
