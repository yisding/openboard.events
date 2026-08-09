CREATE TYPE submission_status AS ENUM ('draft','pending','accept_queue','decline_queue','accepted','declined','withdrawn');
CREATE TYPE submission_kind AS ENUM ('abstract','session');
CREATE TYPE submission_source AS ENUM ('cfp','manual','import');
CREATE TYPE form_context AS ENUM ('cfp','portal');
CREATE TYPE form_status AS ENUM ('draft','open','closed');
CREATE TYPE field_type AS ENUM ('text','textarea','richtext','dropdown','multiselect','radio','checkbox','email','phone','url','number','date','file');
CREATE TYPE participant_role AS ENUM ('speaker','co_speaker','moderator','panelist');
CREATE TYPE confirmation_status AS ENUM ('unconfirmed','confirmed','declined');
CREATE TYPE member_role AS ENUM ('owner','organizer','reviewer');
CREATE TYPE task_target AS ENUM ('contact','submission');
CREATE TYPE task_mode AS ENUM ('manual','form','file_request');
CREATE TYPE completion_via AS ENUM ('manual','form_response','file_upload','admin');
CREATE TYPE session_status AS ENUM ('draft','published');
CREATE TYPE plan_status AS ENUM ('open','closed');
CREATE TYPE embed_content_type AS ENUM ('agenda','session_list','schedule_itinerary','speaker_list','speaker_gallery');
CREATE TYPE template_key AS ENUM ('submission_received','submission_accepted','submission_declined','task_assigned','task_reminder','schedule_assigned','schedule_changed','portal_login');
CREATE TYPE comm_status AS ENUM ('queued','sent','failed','skipped');
CREATE TYPE ics_method AS ENUM ('request','cancel');
CREATE TYPE token_purpose AS ENUM ('magic_link','ics_download','impersonation');
CREATE TYPE file_kind AS ENUM ('logo','background','headshot','attachment','slide','upload');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  name text NOT NULL DEFAULT '',
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9](-?[a-z0-9])*$')
    CHECK (slug NOT IN ('api','submit','admin','portal','e','embed','assets','app','cal','f','login')),
  event_type text NOT NULL DEFAULT 'conference',
  website_url text,
  location text,
  timezone text NOT NULL DEFAULT 'America/Los_Angeles',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  theme text CHECK (char_length(theme) <= 1000),
  logo_file_id uuid,
  background_file_id uuid,
  submission_cap_per_user integer NOT NULL DEFAULT 3 CHECK (submission_cap_per_user > 0),
  submission_seq integer NOT NULL DEFAULT 0 CHECK (submission_seq >= 0),
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE event_members (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'organizer',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,event_id)
);

CREATE TABLE file_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind file_kind NOT NULL DEFAULT 'upload',
  r2_key text NOT NULL UNIQUE,
  filename text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_by_contact_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,event_id)
);
ALTER TABLE events ADD CONSTRAINT events_logo_fk FOREIGN KEY (logo_file_id,id) REFERENCES file_assets(id,event_id) ON DELETE SET NULL (logo_file_id);
ALTER TABLE events ADD CONSTRAINT events_background_fk FOREIGN KEY (background_file_id,id) REFERENCES file_assets(id,event_id) ON DELETE SET NULL (background_file_id);

CREATE TABLE tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL, color text NOT NULL DEFAULT '#6366f1', description text, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id,name), UNIQUE (id,event_id)
);
CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL, capacity integer, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id,name), UNIQUE (id,event_id)
);
CREATE TABLE session_formats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL, default_duration_mins integer NOT NULL DEFAULT 30 CHECK (default_duration_mins > 0), sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id,name), UNIQUE (id,event_id)
);
CREATE TABLE tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL, color text NOT NULL DEFAULT '#6366f1', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id,name), UNIQUE (id,event_id)
);

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(btrim(email))), first_name text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '',
  salutation text, honorific text, pronouns text, gender text, job_title text, company text, bio_html text,
  headshot_file_id uuid, linkedin_url text, twitter_url text, facebook_url text, website_url text,
  confirmation_status confirmation_status NOT NULL DEFAULT 'unconfirmed', unsubscribed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id,email), UNIQUE (id,event_id)
);
ALTER TABLE contacts ADD CONSTRAINT contacts_headshot_fk FOREIGN KEY (headshot_file_id,event_id) REFERENCES file_assets(id,event_id) ON DELETE SET NULL (headshot_file_id);
ALTER TABLE file_assets ADD CONSTRAINT file_assets_contact_fk FOREIGN KEY (uploaded_by_contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE SET NULL (uploaded_by_contact_id);

CREATE TABLE portal_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE, contact_id uuid NOT NULL,
  purpose token_purpose NOT NULL, token_hash text NOT NULL UNIQUE, otp_hash text, expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,event_id), FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE CASCADE
);
CREATE INDEX portal_tokens_contact_purpose_idx ON portal_tokens(contact_id,purpose);
CREATE TABLE portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE, contact_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE, impersonated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,event_id), FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE CASCADE
);
CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_login_attempts (
  key_hash text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts > 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL, key_hash text NOT NULL UNIQUE, last_used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,event_id)
);

CREATE TABLE forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  context form_context NOT NULL, internal_name text NOT NULL, external_title text NOT NULL DEFAULT '', page_heading varchar(15) NOT NULL DEFAULT 'Welcome!',
  status form_status NOT NULL DEFAULT 'draft', kind submission_kind NOT NULL DEFAULT 'abstract', collect_participants boolean NOT NULL DEFAULT true,
  opens_at timestamptz, closes_at timestamptz, submission_limit integer, show_welcome boolean NOT NULL DEFAULT true,
  welcome_html text, success_html text, auto_redirect_to_portal boolean NOT NULL DEFAULT true,
  participant_roles jsonb NOT NULL DEFAULT '[{"role":"speaker","enabled":true,"min":1,"max":null}]',
  send_confirmation boolean NOT NULL DEFAULT true, confirmation_subject text, confirmation_body_html text,
  target_type task_target, current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0), row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,event_id), CHECK (context <> 'portal' OR target_type IS NOT NULL)
);
CREATE INDEX forms_event_context_status_idx ON forms(event_id,context,status);
CREATE TABLE form_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, form_id uuid NOT NULL, key text NOT NULL,
  title text NOT NULL DEFAULT '', page_heading varchar(15) NOT NULL DEFAULT '', description_html text, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (form_id,event_id) REFERENCES forms(id,event_id) ON DELETE CASCADE, UNIQUE (form_id,key), UNIQUE (id,event_id)
);
CREATE TABLE form_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, form_id uuid NOT NULL, section_id uuid NOT NULL,
  key text NOT NULL, label text NOT NULL, field_type field_type NOT NULL, required boolean NOT NULL DEFAULT false,
  locked boolean NOT NULL DEFAULT false, max_chars integer, help_text text, options jsonb, visibility jsonb, maps_to text,
  sort_order integer NOT NULL DEFAULT 0, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (form_id,event_id) REFERENCES forms(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (section_id,event_id) REFERENCES form_sections(id,event_id) ON DELETE CASCADE,
  UNIQUE (id,event_id)
);
CREATE UNIQUE INDEX form_fields_key_live_uq ON form_fields(form_id,key) WHERE deleted_at IS NULL;
CREATE TABLE form_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, form_id uuid NOT NULL, version integer NOT NULL,
  snapshot jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(), published_by uuid REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (form_id,event_id) REFERENCES forms(id,event_id) ON DELETE CASCADE, UNIQUE (form_id,version), UNIQUE (id,event_id)
);
CREATE TABLE routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, form_id uuid NOT NULL, sort_order integer NOT NULL DEFAULT 0,
  match text NOT NULL DEFAULT 'all' CHECK (match IN ('all','any')), conditions jsonb NOT NULL, set_track_id uuid,
  add_tag_ids uuid[] NOT NULL DEFAULT '{}', enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (form_id,event_id) REFERENCES forms(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (set_track_id,event_id) REFERENCES tracks(id,event_id) ON DELETE SET NULL (set_track_id), UNIQUE (id,event_id)
);

CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  form_id uuid, form_version integer, code integer NOT NULL, kind submission_kind NOT NULL DEFAULT 'abstract',
  status submission_status NOT NULL DEFAULT 'draft', source submission_source NOT NULL DEFAULT 'cfp',
  title varchar(255) NOT NULL DEFAULT '', description_html text, track_id uuid, format_id uuid, level text, language text,
  capacity integer, ceu_credits numeric, starts_at timestamptz, ends_at timestamptz, client_session_id text,
  submitter_contact_id uuid, submitted_at timestamptz, decided_at timestamptz, notified_at timestamptz,
  notify_revision integer NOT NULL DEFAULT 0, withdrawn_at timestamptz, row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id,code), UNIQUE (id,event_id),
  FOREIGN KEY (form_id,event_id) REFERENCES forms(id,event_id) ON DELETE SET NULL (form_id),
  FOREIGN KEY (track_id,event_id) REFERENCES tracks(id,event_id) ON DELETE SET NULL (track_id),
  FOREIGN KEY (format_id,event_id) REFERENCES session_formats(id,event_id) ON DELETE SET NULL (format_id),
  FOREIGN KEY (submitter_contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE SET NULL (submitter_contact_id)
);
CREATE INDEX submissions_event_status_idx ON submissions(event_id,status);
CREATE INDEX submissions_event_form_idx ON submissions(event_id,form_id);
CREATE INDEX submissions_event_track_idx ON submissions(event_id,track_id);
CREATE INDEX submissions_event_submitter_idx ON submissions(event_id,submitter_contact_id);
CREATE INDEX submissions_event_submitted_idx ON submissions(event_id,submitted_at DESC NULLS LAST);
CREATE UNIQUE INDEX submissions_one_draft_per_contact_form_uq ON submissions(event_id,form_id,submitter_contact_id)
  WHERE status='draft' AND form_id IS NOT NULL AND submitter_contact_id IS NOT NULL;
CREATE TABLE submission_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, submission_id uuid NOT NULL, contact_id uuid NOT NULL,
  role participant_role NOT NULL DEFAULT 'speaker', is_primary boolean NOT NULL DEFAULT false, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE CASCADE,
  UNIQUE (submission_id,contact_id), UNIQUE (id,event_id)
);
CREATE UNIQUE INDEX submission_primary_uq ON submission_participants(submission_id) WHERE is_primary;
CREATE INDEX submission_participants_event_contact_idx ON submission_participants(event_id,contact_id);
CREATE TABLE submission_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, submission_id uuid NOT NULL,
  field_id uuid NOT NULL, participant_id uuid, value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (field_id,event_id) REFERENCES form_fields(id,event_id),
  FOREIGN KEY (participant_id,event_id) REFERENCES submission_participants(id,event_id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (submission_id,field_id,participant_id), UNIQUE (id,event_id)
);
CREATE TABLE submission_tags (
  event_id uuid NOT NULL, submission_id uuid NOT NULL, tag_id uuid NOT NULL,
  PRIMARY KEY (submission_id,tag_id),
  FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id,event_id) REFERENCES tags(id,event_id) ON DELETE CASCADE
);

CREATE TABLE evaluation_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL, round integer NOT NULL DEFAULT 1, scale_min integer NOT NULL DEFAULT 1, scale_max integer NOT NULL DEFAULT 5,
  status plan_status NOT NULL DEFAULT 'open', track_ids uuid[], created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id,name), UNIQUE (id,event_id), CHECK (scale_max > scale_min)
);
CREATE TABLE evaluation_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, plan_id uuid NOT NULL, label text NOT NULL,
  weight numeric NOT NULL DEFAULT 1, sort_order integer NOT NULL DEFAULT 0,
  FOREIGN KEY (plan_id,event_id) REFERENCES evaluation_plans(id,event_id) ON DELETE CASCADE, UNIQUE (id,event_id)
);
CREATE TABLE reviewer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, plan_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, track_ids uuid[],
  FOREIGN KEY (plan_id,event_id) REFERENCES evaluation_plans(id,event_id) ON DELETE CASCADE,
  UNIQUE (plan_id,user_id), UNIQUE (id,event_id)
);
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, plan_id uuid NOT NULL, submission_id uuid NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, overall_score numeric, criterion_scores jsonb NOT NULL DEFAULT '{}',
  comment text, is_ai boolean NOT NULL DEFAULT false, submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (plan_id,event_id) REFERENCES evaluation_plans(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE CASCADE,
  UNIQUE (plan_id,submission_id,reviewer_user_id), UNIQUE (id,event_id)
);
CREATE INDEX reviews_event_submission_idx ON reviews(event_id,submission_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  submission_id uuid UNIQUE, title text NOT NULL, slug text NOT NULL, description_html text, format_id uuid, track_id uuid, room_id uuid,
  starts_at timestamptz, ends_at timestamptz, status session_status NOT NULL DEFAULT 'draft', schedule_revision integer NOT NULL DEFAULT 0,
  row_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id,slug), UNIQUE (id,event_id),
  FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE SET NULL (submission_id),
  FOREIGN KEY (format_id,event_id) REFERENCES session_formats(id,event_id) ON DELETE SET NULL (format_id),
  FOREIGN KEY (track_id,event_id) REFERENCES tracks(id,event_id) ON DELETE SET NULL (track_id),
  FOREIGN KEY (room_id,event_id) REFERENCES rooms(id,event_id) ON DELETE SET NULL (room_id),
  CHECK ((starts_at IS NULL)=(ends_at IS NULL)), CHECK (starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX sessions_event_start_idx ON sessions(event_id,starts_at);
CREATE INDEX sessions_event_room_start_idx ON sessions(event_id,room_id,starts_at);
CREATE INDEX sessions_event_status_idx ON sessions(event_id,status);
CREATE TABLE session_speakers (
  event_id uuid NOT NULL, session_id uuid NOT NULL, contact_id uuid NOT NULL, role participant_role NOT NULL DEFAULT 'speaker', sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id,contact_id),
  FOREIGN KEY (session_id,event_id) REFERENCES sessions(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE CASCADE
);
CREATE INDEX session_speakers_event_contact_idx ON session_speakers(event_id,contact_id);

CREATE TABLE file_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL, target_type task_target NOT NULL DEFAULT 'contact', instructions_html text,
  accepted_extensions text[] NOT NULL DEFAULT '{pdf,ppt,pptx,key,zip,png,jpg,jpeg}', max_size_mb integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id,event_id)
);
CREATE TABLE portal_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL, description_html text, target_type task_target NOT NULL DEFAULT 'contact', completion_mode task_mode NOT NULL DEFAULT 'manual',
  form_id uuid, file_request_id uuid, due_at timestamptz, is_active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id,event_id),
  FOREIGN KEY (form_id,event_id) REFERENCES forms(id,event_id) ON DELETE RESTRICT,
  FOREIGN KEY (file_request_id,event_id) REFERENCES file_requests(id,event_id) ON DELETE RESTRICT,
  CHECK ((completion_mode='form')=(form_id IS NOT NULL)), CHECK ((completion_mode='file_request')=(file_request_id IS NOT NULL))
);
CREATE TABLE task_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, task_id uuid NOT NULL, contact_id uuid NOT NULL,
  submission_id uuid, completed_via completion_via NOT NULL, form_response_id uuid, file_upload_id uuid,
  completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL, completed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id,event_id) REFERENCES portal_tasks(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (task_id,contact_id,submission_id), UNIQUE (id,event_id)
);
CREATE INDEX task_completions_event_contact_idx ON task_completions(event_id,contact_id);
CREATE TABLE form_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, form_id uuid NOT NULL, form_version integer NOT NULL,
  contact_id uuid NOT NULL, submission_id uuid, answers jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (form_id,event_id) REFERENCES forms(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (form_id,contact_id,submission_id), UNIQUE (id,event_id)
);
CREATE TABLE file_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, file_request_id uuid NOT NULL, contact_id uuid NOT NULL,
  submission_id uuid, file_asset_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (file_request_id,event_id) REFERENCES file_requests(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (file_asset_id,event_id) REFERENCES file_assets(id,event_id) ON DELETE CASCADE, UNIQUE (id,event_id)
);
CREATE INDEX file_uploads_request_contact_idx ON file_uploads(file_request_id,contact_id);
ALTER TABLE task_completions ADD CONSTRAINT task_completions_response_fk FOREIGN KEY (form_response_id,event_id) REFERENCES form_responses(id,event_id) ON DELETE SET NULL (form_response_id);
ALTER TABLE task_completions ADD CONSTRAINT task_completions_upload_fk FOREIGN KEY (file_upload_id,event_id) REFERENCES file_uploads(id,event_id) ON DELETE SET NULL (file_upload_id);
CREATE TABLE resource_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title text NOT NULL, slug text NOT NULL, summary text NOT NULL DEFAULT '', body_html text, sort_order integer NOT NULL DEFAULT 0,
  published boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id,slug), UNIQUE (id,event_id)
);

CREATE TABLE embeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL, content_type embed_content_type NOT NULL, enabled boolean NOT NULL DEFAULT true,
  style jsonb NOT NULL DEFAULT '{}', filters jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,event_id)
);

CREATE TABLE email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key template_key NOT NULL, subject text NOT NULL, body_html text NOT NULL, enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (event_id,key), UNIQUE (id,event_id)
);
CREATE TABLE reminder_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  offset_days integer NOT NULL, enabled boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id,offset_days), UNIQUE (id,event_id)
);
CREATE TABLE communication_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL, template_key template_key NOT NULL, idempotency_key text NOT NULL UNIQUE, status comm_status NOT NULL DEFAULT 'queued',
  subject_rendered text, body_rendered_html text, secret_payload_ciphertext bytea, error text, provider_message_id text, ics_uid text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0), next_attempt_at timestamptz NOT NULL DEFAULT now(), locked_until timestamptz,
  submission_id uuid, session_id uuid, task_id uuid, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz,
  FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE SET NULL (submission_id),
  FOREIGN KEY (session_id,event_id) REFERENCES sessions(id,event_id) ON DELETE SET NULL (session_id),
  FOREIGN KEY (task_id,event_id) REFERENCES portal_tasks(id,event_id) ON DELETE SET NULL (task_id),
  UNIQUE (id,event_id), CHECK ((template_key='portal_login') OR secret_payload_ciphertext IS NULL)
);
CREATE INDEX communication_logs_queued_idx ON communication_logs(event_id,status) WHERE status='queued';
CREATE INDEX communication_logs_contact_created_idx ON communication_logs(event_id,contact_id,created_at DESC);
CREATE TABLE calendar_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL, contact_id uuid NOT NULL, session_id uuid NOT NULL,
  ics_uid text NOT NULL UNIQUE, sequence integer NOT NULL DEFAULT 0, last_method ics_method NOT NULL DEFAULT 'request',
  organizer_email text NOT NULL, last_sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id,event_id) REFERENCES sessions(id,event_id) ON DELETE CASCADE,
  UNIQUE (contact_id,session_id), UNIQUE (id,event_id)
);

CREATE TABLE airtable_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  table_name text NOT NULL, record_pk text NOT NULL, airtable_record_id text NOT NULL, content_hash text NOT NULL,
  last_synced_at timestamptz NOT NULL DEFAULT now(), UNIQUE (event_id,table_name,record_pk), UNIQUE (id,event_id)
);
CREATE TABLE airtable_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  trigger text NOT NULL CHECK (trigger IN ('manual','cron')), status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, stats jsonb NOT NULL DEFAULT '{}', error text,
  UNIQUE (id,event_id)
);
