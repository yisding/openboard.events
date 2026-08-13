-- One-time repair for preview/demo rows left behind before the browser suite
-- gained guaranteed teardown. Match only the timestamp-shaped titles emitted
-- by those specs; user-authored sessions that merely mention E2E are not test
-- residue and must remain untouched.
DELETE FROM sessions AS session
USING events AS event
WHERE session.event_id = event.id
  AND event.slug = 'ai-engineer-sandbox-event'
  AND (
    session.title ~ '^E2E (publish me|overlap [AB]|auto-place|blacked out) [0-9]+$'
    OR session.title ~ '^E2E content history (original|edit one|edit two) [0-9]+$'
  );

-- The portal profile spec typed its marker at the start of an existing rich
-- text bio, sometimes repeatedly across runs. Preserve the opening paragraph
-- tag and every byte of the real biography after the timestamp prefixes.
-- TipTap may wrap text typed at the active cursor in `<strong>`; accept that
-- exact optional inline wrapper as part of each marker, not as biography.
UPDATE contacts AS speaker
SET bio_html = regexp_replace(
  speaker.bio_html,
  '^((<p[^>]*>)?)((<strong[^>]*>)?E2E bio [0-9]+(</strong>)?[[:space:]]*)+',
  '\1',
  'i'
), updated_at = now()
FROM events AS event
WHERE speaker.event_id = event.id
  AND event.slug = 'ai-engineer-sandbox-event'
  AND speaker.bio_html ~* '^((<p[^>]*>)?)((<strong[^>]*>)?E2E bio [0-9]+(</strong>)?[[:space:]]*)+';

-- Both public-surface specs temporarily declined the deterministic Grace seed
-- and, before teardown existed, left her out of the demo gallery. Repair only
-- that exact seed row in that exact demo event; real declined speakers remain
-- decisions, not cleanup candidates.
UPDATE contacts AS speaker
SET confirmation_status = 'confirmed', updated_at = now()
FROM events AS event
WHERE speaker.id = '8c33e03d-60c7-58ac-b4a6-2e56b80f829b'::uuid
  AND speaker.event_id = event.id
  AND event.slug = 'ai-engineer-sandbox-event'
  AND speaker.confirmation_status = 'declined';
