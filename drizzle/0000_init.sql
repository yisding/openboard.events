CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE submission_status AS ENUM ('draft','pending','accept_queue','decline_queue','accepted','declined','withdrawn');
CREATE TYPE form_status AS ENUM ('draft','open','closed');
CREATE TYPE form_context AS ENUM ('cfp','portal');
CREATE TYPE field_type AS ENUM ('text','textarea','richtext','dropdown','multiselect','radio','checkbox','email','phone','url','number','date','file');
CREATE TYPE confirmation_status AS ENUM ('unconfirmed','confirmed','declined');
CREATE TYPE task_target AS ENUM ('contact','submission');
CREATE TYPE task_mode AS ENUM ('manual','form','file_request');
CREATE TYPE session_status AS ENUM ('draft','published');
CREATE TYPE comm_status AS ENUM ('queued','sent','failed','skipped');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL,
  short_name text NOT NULL,
  timezone text NOT NULL,
  venue text,
  city text,
  starts_at timestamptz,
  ends_at timestamptz,
  accent_color text NOT NULL DEFAULT '#6958D7',
  submission_limit integer NOT NULL DEFAULT 500 CHECK (submission_limit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE event_members (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','organizer','reviewer')),
  PRIMARY KEY (event_id,user_id)
);

CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  company text NOT NULL DEFAULT '',
  job_title text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  website text NOT NULL DEFAULT '',
  linkedin text NOT NULL DEFAULT '',
  confirmation_status confirmation_status NOT NULL DEFAULT 'unconfirmed',
  headshot_file_id uuid,
  row_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id,email),
  UNIQUE (id,event_id)
);

CREATE TABLE file_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contact_id uuid,
  kind text NOT NULL,
  object_key text NOT NULL UNIQUE,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint,
  finalized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,event_id)
);
-- Composite (id,event_id) foreign keys make cross-event references a
-- constraint violation instead of an application bug. ON DELETE SET NULL
-- nulls only the id column (PostgreSQL 15+), never event_id.
ALTER TABLE file_assets ADD CONSTRAINT file_assets_contact_fk FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE SET NULL (contact_id);
ALTER TABLE contacts ADD CONSTRAINT contacts_headshot_fk FOREIGN KEY (headshot_file_id,event_id) REFERENCES file_assets(id,event_id) ON DELETE SET NULL (headshot_file_id);

CREATE TABLE tracks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,name text NOT NULL,color text NOT NULL DEFAULT '#6958D7',sort_order integer NOT NULL,UNIQUE(event_id,name),UNIQUE(id,event_id));
CREATE TABLE rooms (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,name text NOT NULL,capacity integer,sort_order integer NOT NULL,UNIQUE(event_id,name),UNIQUE(id,event_id));
CREATE TABLE session_formats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,name text NOT NULL,duration_minutes integer NOT NULL CHECK(duration_minutes>0),sort_order integer NOT NULL,UNIQUE(event_id,name),UNIQUE(id,event_id));
CREATE TABLE tags (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,name text NOT NULL,color text NOT NULL DEFAULT '#6958D7',UNIQUE(event_id,name),UNIQUE(id,event_id));

CREATE TABLE forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name text NOT NULL,slug text NOT NULL,status form_status NOT NULL DEFAULT 'draft',context form_context NOT NULL DEFAULT 'cfp',
  opens_at timestamptz,closes_at timestamptz,max_per_contact integer NOT NULL DEFAULT 3,submission_limit integer,
  current_version integer NOT NULL DEFAULT 1,welcome_title text NOT NULL DEFAULT '',welcome_html text NOT NULL DEFAULT '',
  success_title text NOT NULL DEFAULT '',success_html text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id,slug),
  UNIQUE(id,event_id)
);
CREATE TABLE form_sections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,key text NOT NULL,title text NOT NULL,description_html text NOT NULL DEFAULT '',sort_order integer NOT NULL,UNIQUE(form_id,key));
CREATE TABLE form_fields (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,section_id uuid NOT NULL REFERENCES form_sections(id) ON DELETE CASCADE,key text NOT NULL,label text NOT NULL,field_type field_type NOT NULL,required boolean NOT NULL DEFAULT false,locked boolean NOT NULL DEFAULT false,help_text text NOT NULL DEFAULT '',placeholder text NOT NULL DEFAULT '',max_chars integer,options jsonb NOT NULL DEFAULT '[]',visibility jsonb,sort_order integer NOT NULL,deleted_at timestamptz,UNIQUE(form_id,key));
CREATE TABLE form_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,version integer NOT NULL,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(form_id,version));
CREATE TABLE routing_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),form_id uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE,name text NOT NULL,conditions jsonb NOT NULL,track_id uuid REFERENCES tracks(id) ON DELETE SET NULL,tag_ids jsonb NOT NULL DEFAULT '[]',active boolean NOT NULL DEFAULT true,sort_order integer NOT NULL);

CREATE SEQUENCE submission_code_seq;
CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,form_id uuid NOT NULL,form_version integer NOT NULL,
  code text NOT NULL,status submission_status NOT NULL DEFAULT 'draft',title text NOT NULL DEFAULT '',abstract text NOT NULL DEFAULT '',track_id uuid,format_id uuid,
  submitted_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),row_version integer NOT NULL DEFAULT 1,notify_revision integer NOT NULL DEFAULT 0,
  UNIQUE(event_id,code),
  UNIQUE(id,event_id),
  FOREIGN KEY (form_id,event_id) REFERENCES forms(id,event_id),
  FOREIGN KEY (track_id,event_id) REFERENCES tracks(id,event_id) ON DELETE SET NULL (track_id),
  FOREIGN KEY (format_id,event_id) REFERENCES session_formats(id,event_id) ON DELETE SET NULL (format_id)
);
CREATE TABLE submission_participants (event_id uuid NOT NULL,submission_id uuid NOT NULL,contact_id uuid NOT NULL,role text NOT NULL DEFAULT 'speaker',is_primary boolean NOT NULL DEFAULT false,PRIMARY KEY(submission_id,contact_id),FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE CASCADE,FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id));
CREATE UNIQUE INDEX one_primary_participant ON submission_participants(submission_id) WHERE is_primary;
CREATE TABLE submission_answers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,field_id uuid NOT NULL,participant_id uuid,answer jsonb NOT NULL,UNIQUE NULLS NOT DISTINCT (submission_id,field_id,participant_id));
CREATE TABLE submission_tags (event_id uuid NOT NULL,submission_id uuid NOT NULL,tag_id uuid NOT NULL,PRIMARY KEY(submission_id,tag_id),FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE CASCADE,FOREIGN KEY (tag_id,event_id) REFERENCES tags(id,event_id) ON DELETE CASCADE);

CREATE TABLE evaluation_plans (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,name text NOT NULL,round_number integer NOT NULL,scale_max integer NOT NULL DEFAULT 5,status text NOT NULL DEFAULT 'open',UNIQUE(id,event_id));
CREATE TABLE reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL,plan_id uuid NOT NULL,submission_id uuid NOT NULL,reviewer_id uuid NOT NULL REFERENCES users(id),score numeric(4,2) NOT NULL,note text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(plan_id,submission_id,reviewer_id),FOREIGN KEY (plan_id,event_id) REFERENCES evaluation_plans(id,event_id) ON DELETE CASCADE,FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE CASCADE);

CREATE TABLE sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,submission_id uuid UNIQUE,title text NOT NULL,description_html text NOT NULL DEFAULT '',track_id uuid,room_id uuid,format_id uuid,starts_at timestamptz,ends_at timestamptz,status session_status NOT NULL DEFAULT 'draft',sequence integer NOT NULL DEFAULT 0,row_version integer NOT NULL DEFAULT 1,CHECK((starts_at IS NULL)=(ends_at IS NULL) AND (starts_at IS NULL OR ends_at>starts_at)),UNIQUE(id,event_id),FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE SET NULL (submission_id),FOREIGN KEY (track_id,event_id) REFERENCES tracks(id,event_id) ON DELETE SET NULL (track_id),FOREIGN KEY (room_id,event_id) REFERENCES rooms(id,event_id) ON DELETE SET NULL (room_id),FOREIGN KEY (format_id,event_id) REFERENCES session_formats(id,event_id) ON DELETE SET NULL (format_id));
CREATE TABLE session_speakers (event_id uuid NOT NULL,session_id uuid NOT NULL,contact_id uuid NOT NULL,sort_order integer NOT NULL DEFAULT 0,PRIMARY KEY(session_id,contact_id),FOREIGN KEY (session_id,event_id) REFERENCES sessions(id,event_id) ON DELETE CASCADE,FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id));

CREATE TABLE portal_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,title text NOT NULL,description_html text NOT NULL DEFAULT '',target task_target NOT NULL,mode task_mode NOT NULL,due_at timestamptz,required boolean NOT NULL DEFAULT true,active boolean NOT NULL DEFAULT true,UNIQUE(id,event_id));
-- Surrogate key: submission_id is NULL for contact-target completions, and
-- primary-key columns cannot be nullable. Uniqueness moves to the
-- NULLS NOT DISTINCT constraint below.
CREATE TABLE task_completions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL,task_id uuid NOT NULL,contact_id uuid NOT NULL,submission_id uuid,completed_at timestamptz NOT NULL DEFAULT now(),completed_via text NOT NULL,response jsonb,file_id uuid,UNIQUE NULLS NOT DISTINCT (task_id,contact_id,submission_id),FOREIGN KEY (task_id,event_id) REFERENCES portal_tasks(id,event_id) ON DELETE CASCADE,FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id),FOREIGN KEY (submission_id,event_id) REFERENCES submissions(id,event_id) ON DELETE CASCADE,FOREIGN KEY (file_id,event_id) REFERENCES file_assets(id,event_id) ON DELETE SET NULL (file_id));
CREATE TABLE resource_pages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,title text NOT NULL,slug text NOT NULL,summary text NOT NULL DEFAULT '',body_html text NOT NULL,published boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(event_id,slug));

CREATE TABLE email_templates (event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,key text NOT NULL,subject text NOT NULL,body_html text NOT NULL,enabled boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(event_id,key));
CREATE TABLE reminder_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,offset_days integer NOT NULL,enabled boolean NOT NULL DEFAULT true,UNIQUE(event_id,offset_days));
CREATE TABLE communication_logs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,contact_id uuid,template_key text NOT NULL,idempotency_key text NOT NULL UNIQUE,recipient text NOT NULL,subject text,status comm_status NOT NULL DEFAULT 'queued',rendered_html text,error text,attempts integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL DEFAULT now(),sent_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id) ON DELETE SET NULL (contact_id));
CREATE INDEX communication_outbox_claim ON communication_logs(status,available_at) WHERE status='queued';
-- ics_uid and organizer are minted on the first REQUEST and reused verbatim on
-- every reschedule and CANCEL so calendar clients track one stable event.
CREATE TABLE calendar_invites (event_id uuid NOT NULL,session_id uuid NOT NULL,contact_id uuid NOT NULL,ics_uid text NOT NULL,organizer_email text NOT NULL,sequence integer NOT NULL DEFAULT 0,last_method text NOT NULL DEFAULT 'request',updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(session_id,contact_id),UNIQUE(ics_uid),FOREIGN KEY (session_id,event_id) REFERENCES sessions(id,event_id) ON DELETE CASCADE,FOREIGN KEY (contact_id,event_id) REFERENCES contacts(id,event_id));
CREATE TABLE api_keys (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,name text NOT NULL,key_hash text NOT NULL UNIQUE,last_used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX submissions_event_status ON submissions(event_id,status);
CREATE INDEX sessions_event_start ON sessions(event_id,starts_at);
CREATE INDEX contacts_event_confirmation ON contacts(event_id,confirmation_status);
