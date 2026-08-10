-- M52 — content and deliverables lifecycle: file versions/comments, session
-- content revision history, and asynchronous latest-file export jobs.
--
-- Additive throughout: `file_uploads` grows a version/latest pair over the
-- rows that already accumulate one per upload (`completeTaskViaUpload`
-- already inserts a new row on a re-upload rather than replacing one); the
-- three new tables record what changed and who exported what. Nothing here
-- rewrites an applied migration.

CREATE TYPE file_comment_author_role AS ENUM ('organizer', 'speaker');
CREATE TYPE file_export_status AS ENUM ('pending', 'processing', 'completed', 'failed');
CREATE TYPE file_export_group_by AS ENUM ('none', 'session', 'speaker');

-- Every existing row becomes version 1 / latest by column default; the
-- backfill below only matters where a slot already holds more than one row
-- (a pre-M52 re-upload), where it orders them by arrival and marks only the
-- newest one latest — otherwise the partial unique index below would refuse
-- to build against existing data.
ALTER TABLE file_uploads ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE file_uploads ADD COLUMN is_latest boolean NOT NULL DEFAULT true;

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY file_request_id, contact_id, coalesce(submission_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY created_at, id
    ) AS rn,
    count(*) OVER (
      PARTITION BY file_request_id, contact_id, coalesce(submission_id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) AS total
  FROM file_uploads
)
UPDATE file_uploads f SET version = ranked.rn, is_latest = (ranked.rn = ranked.total)
FROM ranked WHERE ranked.id = f.id;

-- One latest row per (request, contact, submission) slot — the explicit
-- marker the work order requires. `submission_id` is folded through the same
-- sentinel as the backfill above because NULL is never distinct-equal to NULL
-- inside a unique index, so two NULL-submission uploads for the same
-- request/contact would otherwise both pass as "latest".
CREATE UNIQUE INDEX file_uploads_latest_uq ON file_uploads (
  file_request_id, contact_id, coalesce(submission_id, '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE is_latest;
CREATE INDEX file_uploads_slot_version_idx ON file_uploads (file_request_id, contact_id, submission_id, version DESC);

-- File comments: plaintext, threaded on the same (request, contact,
-- submission) slot the versions above share, so a conversation survives a
-- re-upload instead of pinning to one superseded version's row.
-- Authorization mirrors the underlying file: an organizer of the event, or
-- the contact who owns the slot.
CREATE TABLE file_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  file_request_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  submission_id uuid,
  author_role file_comment_author_role NOT NULL,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_contact_id uuid,
  body text NOT NULL CHECK (btrim(body) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (file_request_id, event_id) REFERENCES file_requests(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (submission_id, event_id) REFERENCES submissions(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (author_contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE SET NULL,
  UNIQUE (id, event_id),
  CHECK ((author_role = 'organizer') = (author_user_id IS NOT NULL)),
  CHECK ((author_role = 'speaker') = (author_contact_id IS NOT NULL))
);
CREATE INDEX file_comments_slot_idx ON file_comments (event_id, file_request_id, contact_id, submission_id, created_at);

-- Session content revisions: immutable history of title/description per
-- session, with the editor and (on a restore) the source revision. Restore
-- reads the source and writes the new revision plus the session's current
-- content through one CTE (`restoreSessionContentIn`, `neon-http`), so the
-- two changes land together without opening a ninth `withTx` path.
CREATE TABLE session_content_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  title text NOT NULL,
  description_html text NOT NULL DEFAULT '',
  edited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  restored_from_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, event_id) REFERENCES sessions(id, event_id) ON DELETE CASCADE,
  UNIQUE (id, event_id)
);
CREATE INDEX session_content_revisions_session_idx ON session_content_revisions (session_id, created_at DESC);
-- Self-referencing FK added after the table exists, same deferred-ALTER
-- pattern 0000_init.sql uses for task_completions' forward references.
ALTER TABLE session_content_revisions
  ADD CONSTRAINT session_content_revisions_restored_from_fk
  FOREIGN KEY (restored_from_revision_id, event_id) REFERENCES session_content_revisions(id, event_id) ON DELETE SET NULL;

-- Asynchronous latest-file ZIP export jobs. `file_upload_ids` freezes the
-- server-derived latest-version set at request time, so the export never
-- widens to whatever became latest while the job was still running.
CREATE TABLE file_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status file_export_status NOT NULL DEFAULT 'pending',
  group_by file_export_group_by NOT NULL DEFAULT 'none',
  file_upload_ids uuid[] NOT NULL DEFAULT '{}',
  entry_count integer NOT NULL DEFAULT 0,
  result_file_id uuid,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz,
  FOREIGN KEY (result_file_id, event_id) REFERENCES file_assets(id, event_id) ON DELETE SET NULL,
  UNIQUE (id, event_id)
);
CREATE INDEX file_export_jobs_event_idx ON file_export_jobs (event_id, created_at DESC);
