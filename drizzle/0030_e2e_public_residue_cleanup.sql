-- One-time repair for preview/demo rows left behind before the browser suite
-- gained guaranteed teardown. Match only the timestamp-shaped titles emitted
-- by those specs; user-authored sessions that merely mention E2E are not test
-- residue and must remain untouched.
DELETE FROM sessions
WHERE title ~ '^E2E (publish me|overlap [AB]|auto-place|blacked out) [0-9]+$'
   OR title ~ '^E2E content history (original|edit one|edit two) [0-9]+$';

-- The portal profile spec typed its marker at the start of an existing rich
-- text bio, sometimes repeatedly across runs. Preserve the opening paragraph
-- tag and every byte of the real biography after the timestamp prefixes.
UPDATE contacts
SET bio_html = regexp_replace(
  bio_html,
  '^((<p[^>]*>)?)((E2E bio [0-9]+)[[:space:]]*)+',
  '\1',
  'i'
), updated_at = now()
WHERE bio_html ~* '^((<p[^>]*>)?)((E2E bio [0-9]+)[[:space:]]*)+';
