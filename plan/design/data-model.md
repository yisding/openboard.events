# Data Layer Design — Sessionboard Clone (AI Engineer Hackathon)

Stack (fixed): Next.js App Router on Cloudflare Workers via @opennextjs/cloudflare · Neon Postgres (primary) · Airtable one-way export (bonus) · shadcn/Tailwind · Zustand · TanStack Query · feature folders, parallel AI agents.

This document is the **single source of truth for the database**. Migration `0000` is generated verbatim from Section 3–6. Feature agents consume it; only the schema owner changes it (Section 9).

---

## 0. Decisions at a glance

| Decision | Choice |
|---|---|
| ORM | **Drizzle ORM** (not Prisma) |
| Drivers | `drizzle-orm/neon-http` default; `drizzle-orm/neon-serverless` (WebSocket `Pool`) for the 8 audited transactional functions |
| IDs | `uuid` via `gen_random_uuid()` everywhere; human code `SESS-n` = per-event integer counter |
| Time | Everything `timestamptz` (UTC); `events.timezone` is an IANA name; rendering in event tz is an app concern |
| Enums | Native `pg` enums for lifecycle/contract enums (frozen day 0); plain `text` for soft vocab (level, language, event_type) |
| Event scoping | Every event-scoped table has `event_id NOT NULL` + `UNIQUE(id, event_id)`; **all FKs between event-scoped tables are composite `(x_id, event_id)`** — cross-event references are impossible at the DB level |
| Form engine | One shared engine (`forms`/`form_sections`/`form_fields`) serving both CFP and portal forms; **immutable published snapshots** in `form_versions`; submissions/responses pin a version |
| Conditions | JSON `{match, conditions:[{sourceFieldId, op, value}]}` on the field + in the snapshot; **one shared TS evaluator** used by client and server |
| CFP answers | Normalized rows (`submission_answers`, one row per field × participant, jsonb value) — filterable/exportable |
| Portal answers | Single `answers jsonb` on `form_responses` — low query need, upsert-overwrite |
| Task assignments | **Lazy** (SQL view over tasks × accepted targets); only completions are stored rows |
| State machines | Enum + plpgsql `BEFORE UPDATE` trigger (submissions) + guarded `UPDATE ... WHERE status = $expected` in repositories |
| Soft delete | Only where history depends on it: `form_fields.deleted_at`. Everything else hard-delete or status-based. No generic audit log |
| Comms | Transactional outbox = `communication_logs` rows with `UNIQUE idempotency_key`, `status='queued'`; Cloudflare Cron drains |
| Airtable | One-way, idempotent upsert keyed by `airtable_sync_state(event_id, table_name, record_pk)`, content-hash change detection, 10-rec batches, ≤4 rps, authenticated manual button + optional 10-minute modulo trigger; never in the request path |
| Migrations | drizzle-kit SQL migrations, generated **only on main by the schema owner**; big-bang migration 0000 lands before parallel work; `drizzle-kit push` banned |

---

## 1. ORM: Drizzle vs Prisma → **Drizzle**

Context: OpenNext on Cloudflare **Workers** (no TCP sockets, bundle-size and cold-start sensitive — speed is a judged bonus) + **Neon** serverless driver.

| Criterion | Drizzle | Prisma |
|---|---|---|
| Workers + Neon | First-class: `drizzle-orm/neon-http` (one fetch per query, fastest cold path) and `drizzle-orm/neon-serverless` (WebSocket, real transactions). No engine. | Requires driver-adapter (`@prisma/adapter-neon`) + WASM query engine shipped in the bundle. Works, but heavier and historically the fragile path on Workers. |
| Bundle / cold start | ~tens of KB, pure TS | ~1 MB+ WASM engine → measurable cold-start cost; hurts the "we do not want slow SaaS" bonus |
| Migrations | Plain SQL files, reviewable/diffable — ideal for a serialized parallel-agent workflow; custom SQL (triggers, views, `NULLS NOT DISTINCT`) drops straight in | `schema.prisma` is one central file → guaranteed merge-conflict hotspot for 6 parallel agents; custom SQL via escape hatches |
| Typed contracts | Schema **is** TypeScript; feature agents import table types + `$inferSelect` directly; `drizzle-zod` derives zod DTOs | Generated client is fine but adds a codegen step every agent must run correctly |
| Raw SQL / views | `sql` template + views map cleanly (dashboard read-models are views) | Views are second-class |

**Decision: Drizzle ORM + drizzle-kit.** Prisma's only edge (mature relations API) is not worth the Workers bundle tax and the single-file schema conflict magnet.

### 1.1 Driver strategy (important correctness constraint)

`neon-http` does **not** support interactive transactions (only single statements and non-interactive `db.batch()`). Design rule:

- **Default export `db`** — `drizzle-orm/neon-http`. All reads, all single-statement writes (which we design to be single statements: CTE inserts, guarded updates, `ON CONFLICT` upserts).
- **`withTx(fn)`** — creates a `@neondatabase/serverless` `Pool` per request, runs `drizzle-orm/neon-serverless` transaction, `pool.end()` in `finally` (`ctx.waitUntil`-safe). Used **only** by these named repository functions:
  1. `requestPortalLogin` (invalidate prior challenges + issue a fresh token/OTP + enqueue the login email),
  2. `createSubmission` (deadline + per-user-limit check + counter + answers + outbox insert),
  3. `upsertDraft` (allocate a per-event code + create-or-return the draft + primary participant),
  4. `updateSubmissionFromCfp` (guard ownership/deadline/status + replace answers + field-scoped write-back),
  5. `notifyDecisions` (bulk queue→final flip + outbox inserts),
  6. `completeTaskViaResponse` (response insert + completion insert + optional write-back),
  7. `completeTaskViaUpload` (upload insert + completion insert + optional write-back),
  8. `moveSession` (optimistic-version CAS + `schedule_revision` bump + outbox insert).
- No other deployed function may open a transaction. This keeps burst submits, draft allocation, CFP edits, and OTP issuance safe while confining the runtime WebSocket path to the eight audited functions in PLAN resolution #4. M09's command-line seed orchestrator is the explicit non-runtime exception and uses one transaction for an all-or-nothing reset.

```ts
// src/db/client.ts (owned by data-layer module)
import { neon, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import { getEnv } from "@/shared/lib/env";   // lazy validated access — process.env is banned outside env.ts (M01 grep #2)
import * as schema from "./schema";

export const db = drizzle(neon(getEnv().DATABASE_URL), { schema });

export async function withTx<T>(fn: (tx: TxDb) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
  try {
    const dbWs = drizzleWs(pool, { schema });
    return await dbWs.transaction(fn);
  } finally {
    await pool.end();
  }
}
```

NEEDS-VERIFY (day 0 smoke test): `Pool` + interactive transaction inside an OpenNext-on-Workers route handler (known-good pattern per Neon docs, but verify in *this* adapter before anyone builds on `withTx`). Also confirm the Neon project is PG ≥ 15 (needed for `UNIQUE NULLS NOT DISTINCT`; Neon defaults to 17).

---

## 2. Conventions (apply to every table)

1. `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` unless the PK is a natural composite.
2. `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()` (app sets `updated_at` on update; no trigger — keep writes single-statement-friendly).
3. **Event scoping**: every event-scoped table carries `event_id uuid NOT NULL` with `ON DELETE CASCADE` from `events`, plus `UNIQUE (id, event_id)`. Every FK *between* event-scoped tables is the composite `FOREIGN KEY (x_id, event_id) REFERENCES x(id, event_id)`. An agent literally cannot join a Track from event A onto a Submission from event B. Repository functions take `eventId` as a required first argument — no default.
4. **Optimistic concurrency** where concurrent admin edits matter: `row_version int NOT NULL DEFAULT 1`; updates are `... SET row_version = row_version + 1 WHERE id = $1 AND row_version = $2`, 0 rows → 409. Applies to: `events`, `forms`, `submissions`, `sessions`.
5. Emails stored lowercased+trimmed; enforced by `CHECK (email = lower(btrim(email)))` and normalized in the app.
6. All `*_html` columns store **already-sanitized** HTML. Sanitization happens once at the write boundary via shared `src/shared/sanitize.ts` (allowlist; `resource_pages.body_html` uses a wider allowlist permitting `iframe` per the brief's "HTML embed support"). NEEDS-VERIFY: pick the Workers-compatible sanitizer day 0 (`js-xss` is dependency-light and known to run on Workers; `isomorphic-dompurify` needs jsdom — avoid). Rendering never uses raw `dangerouslySetInnerHTML` on unsanitized input.
7. Char limits (theme 1000, title 255, bio/wysiwyg 5000) count **Unicode code points of plain text** (`[...stripTags(s)].length`), implemented once in `src/shared/contracts/limits.ts`, used by client counters and server validation. DB `varchar(n)`/`CHECK` are a backstop on the raw column.
8. Enum values are defined once as const arrays in `src/shared/contracts/enums.ts`; the Drizzle `pgEnum`s and zod schemas both import them. Enum changes = schema-owner change.

Module ownership of tables (feature folders):

| Module | Owns tables | Key consumers |
|---|---|---|
| `features/events` | events, tracks, rooms, session_formats, tags, users, event_members, file_assets | everyone |
| `features/forms-engine` | forms, form_sections, form_fields, form_versions, routing_rules | cfp, portal |
| `features/cfp` | submissions, submission_participants, submission_answers, submission_tags, contacts, portal_tokens, portal_sessions | abstracts, portal, agenda, comms |
| `features/abstracts` | evaluation_plans, evaluation_criteria, reviewer_assignments, reviews (+ submission status transitions) | dashboard, agenda |
| `features/agenda` | sessions, session_speakers | embeds, comms, portal |
| `features/portal` | portal_tasks, task_completions, file_requests, file_uploads, form_responses, resource_pages | dashboard, comms |
| `features/embeds` | embeds (+ read-only views) | public site |
| `features/comms` | email_templates, reminder_rules, communication_logs, calendar_invites | dashboard |
| `features/airtable-export` | airtable_sync_state, airtable_sync_runs | — |
| `features/dashboard` | **no tables** — reads SQL views only | — |

---

## 3. Schema DDL

Authoritative SQL. (Drizzle schema files in `src/db/schema/*.ts` mirror this 1:1, one file per module, and migration 0000 is generated from them plus the custom SQL in Sections 4/6.)

### 3.0 Enums

```sql
CREATE TYPE submission_status  AS ENUM ('draft','pending','accept_queue','decline_queue','accepted','declined','withdrawn');
CREATE TYPE submission_kind    AS ENUM ('abstract','session');
CREATE TYPE submission_source  AS ENUM ('cfp','manual','import');
CREATE TYPE form_context       AS ENUM ('cfp','portal');
CREATE TYPE form_status        AS ENUM ('draft','open','closed');
CREATE TYPE field_type         AS ENUM ('text','textarea','richtext','dropdown','multiselect','radio','checkbox','email','phone','url','number','date','file');
CREATE TYPE participant_role   AS ENUM ('speaker','co_speaker','moderator','panelist');
CREATE TYPE confirmation_status AS ENUM ('unconfirmed','confirmed','declined');
CREATE TYPE member_role        AS ENUM ('owner','organizer','reviewer');
CREATE TYPE task_target        AS ENUM ('contact','submission');
CREATE TYPE task_mode          AS ENUM ('manual','form','file_request');
CREATE TYPE completion_via     AS ENUM ('manual','form_response','file_upload','admin');
CREATE TYPE session_status     AS ENUM ('draft','published');
CREATE TYPE plan_status        AS ENUM ('open','closed');
CREATE TYPE embed_content_type AS ENUM ('agenda','session_list','schedule_itinerary','speaker_list','speaker_gallery');
CREATE TYPE template_key       AS ENUM ('submission_received','submission_accepted','submission_declined','task_assigned','task_reminder','schedule_assigned','schedule_changed','portal_login');
CREATE TYPE comm_status        AS ENUM ('queued','sent','failed','skipped');
CREATE TYPE ics_method         AS ENUM ('request','cancel');
CREATE TYPE token_purpose      AS ENUM ('magic_link','ics_download','impersonation');
CREATE TYPE file_kind          AS ENUM ('logo','background','headshot','attachment','slide','upload');
```

### 3.1 Identity & events

```sql
CREATE TABLE users (                          -- organizers + reviewers (admin login)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  name          text NOT NULL DEFAULT '',
  password_hash text,                         -- simple credential auth; allowlist seeding
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE
                CHECK (slug ~ '^[a-z0-9](-?[a-z0-9])*$')
                CHECK (slug NOT IN ('api','submit','admin','portal','e','embed','assets','app')),
  event_type    text NOT NULL DEFAULT 'conference',
  website_url   text,
  location      text,
  timezone      text NOT NULL DEFAULT 'America/Los_Angeles',  -- IANA; validated in app
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  theme         text CHECK (char_length(theme) <= 1000),
  logo_file_id       uuid,                    -- FK added post-create (circular with file_assets)
  background_file_id uuid,
  submission_cap_per_user int NOT NULL DEFAULT 3,   -- "Event max: 3"
  submission_seq int NOT NULL DEFAULT 0,            -- SESS-n counter
  row_version   int NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE event_members (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id  uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role      member_role NOT NULL DEFAULT 'organizer',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

CREATE TABLE file_assets (                    -- all R2 object metadata, one place
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind        file_kind NOT NULL DEFAULT 'upload',
  r2_key      text NOT NULL UNIQUE,
  filename    text NOT NULL,
  mime        text NOT NULL,
  size_bytes  bigint NOT NULL DEFAULT 0,
  uploaded_by_user_id    uuid REFERENCES users(id),
  uploaded_by_contact_id uuid,                -- FK added post-create (circular with contacts)
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, event_id)
);
ALTER TABLE events
  ADD CONSTRAINT events_logo_fk FOREIGN KEY (logo_file_id) REFERENCES file_assets(id) ON DELETE SET NULL,
  ADD CONSTRAINT events_bg_fk   FOREIGN KEY (background_file_id) REFERENCES file_assets(id) ON DELETE SET NULL;
```

Upload flow (Workers body-size trap): client asks server for a presigned R2 PUT → uploads directly → confirms → server writes `file_assets` row. Orphaned R2 objects (upload confirmed, never referenced) are acceptable hackathon debt; noted, not engineered around.

### 3.2 Program vocabulary

```sql
CREATE TABLE tracks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#6366f1',   -- hex
  description text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name),
  UNIQUE (id, event_id)
);

CREATE TABLE rooms (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       text NOT NULL,
  capacity   int,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name),
  UNIQUE (id, event_id)
);

CREATE TABLE session_formats (               -- Keynote/Talk/Workshop/Panel/Break; seeded per event
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  default_duration_mins int NOT NULL DEFAULT 30,
  sort_order            int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name),
  UNIQUE (id, event_id)
);

CREATE TABLE tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name),
  UNIQUE (id, event_id)
);
```

There is **one** track/format vocabulary shared by CFP dropdowns, routing, evaluation scoping, agenda, and embeds. Dropdown options for Track/Format fields reference these ids (not free strings) — routing rules match on ids, so renames never orphan rules.

### 3.3 Contacts (speakers) & portal auth

```sql
CREATE TABLE contacts (                       -- per-event person; CFP account == portal login
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email        text NOT NULL CHECK (email = lower(btrim(email))),
  first_name   text NOT NULL DEFAULT '',
  last_name    text NOT NULL DEFAULT '',
  salutation   text, honorific text, pronouns text, gender text,
  job_title    text, company text,
  bio_html     text,                          -- sanitized; ≤5000 plaintext chars (app-enforced)
  headshot_file_id uuid REFERENCES file_assets(id) ON DELETE SET NULL,
  linkedin_url text, twitter_url text, facebook_url text, website_url text,
  confirmation_status confirmation_status NOT NULL DEFAULT 'unconfirmed',
  unsubscribed_at timestamptz,                -- suppresses reminder-class mail only
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, email),
  UNIQUE (id, event_id)
);
ALTER TABLE file_assets
  ADD CONSTRAINT file_assets_contact_fk FOREIGN KEY (uploaded_by_contact_id) REFERENCES contacts(id) ON DELETE SET NULL;

CREATE TABLE portal_tokens (                  -- magic links, ICS download tokens, impersonation
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL,
  purpose     token_purpose NOT NULL,
  token_hash  text NOT NULL UNIQUE,           -- sha256 of the raw token; raw never stored
  otp_hash    text,                           -- portal_login only; scoped lookup also checks event/contact
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at timestamptz,                    -- magic_link: consumed on POST confirm (never GET);
                                              -- ics_download: NULL forever (multi-fetch by calendar clients)
  created_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE CASCADE
);
CREATE INDEX ON portal_tokens (contact_id, purpose);

CREATE TABLE portal_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  impersonated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,  -- admin "view as"
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE CASCADE
);
```

Decision: **no global speaker identity** — a person in two events is two `contacts` rows. Sessions bind (contact, event); no cross-event leakage possible. Typo'd emails are fixable by admin edit (unique constraint re-checked).

### 3.4 Form engine (shared by CFP + portal) — see Section 5 for semantics

```sql
CREATE TABLE forms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- uuid doubles as public URL token
  event_id           uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  context            form_context NOT NULL,                        -- 'cfp' | 'portal'
  internal_name      text NOT NULL,
  external_title     text NOT NULL DEFAULT '',
  page_heading       varchar(15) NOT NULL DEFAULT 'Welcome!',
  status             form_status NOT NULL DEFAULT 'draft',
  -- CFP-only settings (NULL/default for portal forms)
  kind               submission_kind NOT NULL DEFAULT 'abstract',
  collect_participants boolean NOT NULL DEFAULT true,
  opens_at           timestamptz,
  closes_at          timestamptz,             -- closes NEW and UPDATED submissions; server-enforced
  submission_limit   int,                     -- NULL → events.submission_cap_per_user
  show_welcome       boolean NOT NULL DEFAULT true,
  welcome_html       text,
  success_html       text,
  auto_redirect_to_portal boolean NOT NULL DEFAULT true,
  participant_roles  jsonb NOT NULL DEFAULT '[{"role":"speaker","enabled":true,"min":1,"max":null}]',
  -- notifications
  send_confirmation  boolean NOT NULL DEFAULT true,
  confirmation_subject text,                  -- NULL → event template 'submission_received'
  confirmation_body_html text,
  -- portal-only
  target_type        task_target,             -- required when context='portal'
  current_version    int NOT NULL DEFAULT 0,  -- 0 = never published
  row_version        int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, event_id),
  CHECK (context <> 'portal' OR target_type IS NOT NULL)
);
CREATE INDEX ON forms (event_id, context, status);

CREATE TABLE form_sections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL,
  form_id          uuid NOT NULL,
  key              text NOT NULL,             -- 'abstract' | 'participant' | custom (portal)
  title            text NOT NULL DEFAULT '',
  page_heading     varchar(15) NOT NULL DEFAULT '',
  description_html text,
  sort_order       int NOT NULL DEFAULT 0,
  FOREIGN KEY (form_id, event_id) REFERENCES forms(id, event_id) ON DELETE CASCADE,
  UNIQUE (form_id, key),
  UNIQUE (id, event_id)
);

CREATE TABLE form_fields (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- IMMUTABLE; answers key on this
  event_id    uuid NOT NULL,
  form_id     uuid NOT NULL,
  section_id  uuid NOT NULL,
  key         text NOT NULL,                  -- machine key for merge tags/export ('title','bio',…)
  label       text NOT NULL,
  field_type  field_type NOT NULL,
  required    boolean NOT NULL DEFAULT false,
  locked      boolean NOT NULL DEFAULT false, -- Title/FirstName/LastName/Email; server rejects delete/un-require/retype
  max_chars   int,
  help_text   text,
  options     jsonb,        -- choice types: [{id: uuid, label: text, trackId?: uuid, formatId?: uuid, tagId?: uuid}]
  visibility  jsonb,        -- NULL = always visible; see §5.2
  maps_to     text,         -- write-back target: 'submission.title','submission.description_html',
                            -- 'submission.track_id','submission.format_id','contact.first_name',
                            -- 'contact.last_name','contact.email','contact.bio_html','contact.company',… (closed allowlist in contracts)
  sort_order  int NOT NULL DEFAULT 0,
  deleted_at  timestamptz,                    -- SOFT DELETE: answers survive, field hidden from builder+runtime
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (form_id, event_id)    REFERENCES forms(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (section_id, event_id) REFERENCES form_sections(id, event_id) ON DELETE CASCADE,
  UNIQUE (id, event_id)
);
CREATE UNIQUE INDEX form_fields_key_live_uq ON form_fields (form_id, key) WHERE deleted_at IS NULL;

CREATE TABLE form_versions (                  -- immutable published snapshots; see §5.1
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL,
  form_id      uuid NOT NULL,
  version      int  NOT NULL,
  snapshot     jsonb NOT NULL,                -- compiled FormSnapshot (sections+fields+visibility)
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES users(id),
  FOREIGN KEY (form_id, event_id) REFERENCES forms(id, event_id) ON DELETE CASCADE,
  UNIQUE (form_id, version)
);

CREATE TABLE routing_rules (                  -- CFP category routing; first-match wins
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL,
  form_id    uuid NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  match      text NOT NULL DEFAULT 'all' CHECK (match IN ('all','any')),
  conditions jsonb NOT NULL,                  -- same shape as visibility conditions
  set_track_id uuid,
  add_tag_ids  uuid[] NOT NULL DEFAULT '{}',
  enabled    boolean NOT NULL DEFAULT true,
  FOREIGN KEY (form_id, event_id)     REFERENCES forms(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (set_track_id, event_id) REFERENCES tracks(id, event_id) ON DELETE SET NULL,
  UNIQUE (id, event_id)
);
```

### 3.5 Submissions (abstracts)

```sql
CREATE TABLE submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  form_id      uuid,                          -- NULL = manual/import
  form_version int,                           -- version of the snapshot this was answered against
  code         int NOT NULL,                  -- renders as "SESS-{code}"
  kind         submission_kind NOT NULL DEFAULT 'abstract',
  status       submission_status NOT NULL DEFAULT 'draft',
  source       submission_source NOT NULL DEFAULT 'cfp',
  title        varchar(255) NOT NULL DEFAULT '',
  description_html text,                      -- sanitized (public input rendered in admin!)
  track_id     uuid,                          -- routing output / CFP answer / manual
  format_id    uuid,
  level        text, language text,           -- soft vocab, plain text
  capacity     int, ceu_credits numeric,
  starts_at    timestamptz, ends_at timestamptz,   -- proto-session fields from Add Abstract drawer
  client_session_id text,                     -- free text, NOT unique
  submitter_contact_id uuid,                  -- NULL only for manual/import rows
  submitted_at timestamptz,
  decided_at   timestamptz,
  notified_at  timestamptz,                   -- idempotency guard for decision emails
  notify_revision int NOT NULL DEFAULT 0,      -- bumped whenever a final decision is undone
  withdrawn_at timestamptz,
  row_version  int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, code),
  UNIQUE (id, event_id),
  FOREIGN KEY (form_id, event_id)   REFERENCES forms(id, event_id)   ON DELETE SET NULL (form_id),
  FOREIGN KEY (track_id, event_id)  REFERENCES tracks(id, event_id)  ON DELETE SET NULL (track_id),
  FOREIGN KEY (format_id, event_id) REFERENCES session_formats(id, event_id) ON DELETE SET NULL (format_id),
  FOREIGN KEY (submitter_contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE SET NULL (submitter_contact_id)
);
-- Note: "ON DELETE SET NULL (col)" is the PG15+ column-list form required because event_id must not be nulled.
CREATE INDEX ON submissions (event_id, status);
CREATE INDEX ON submissions (event_id, form_id);
CREATE INDEX ON submissions (event_id, track_id);
CREATE INDEX ON submissions (event_id, submitter_contact_id);
CREATE INDEX ON submissions (event_id, submitted_at DESC NULLS LAST);
-- One server draft per (contact, form): the DB-level guarantee behind upsertDraft's create-or-return
-- (M16's dependency note cites this index; concurrent Account-step requests race safely onto one row).
CREATE UNIQUE INDEX submissions_one_draft_per_contact_form_uq
  ON submissions (event_id, form_id, submitter_contact_id)
  WHERE status = 'draft' AND form_id IS NOT NULL AND submitter_contact_id IS NOT NULL;

CREATE TABLE submission_participants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL,
  submission_id uuid NOT NULL,
  contact_id    uuid NOT NULL,
  role          participant_role NOT NULL DEFAULT 'speaker',
  is_primary    boolean NOT NULL DEFAULT false,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (submission_id, event_id) REFERENCES submissions(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, event_id)    REFERENCES contacts(id, event_id)    ON DELETE CASCADE,
  UNIQUE (submission_id, contact_id),
  UNIQUE (id, event_id)
);
CREATE UNIQUE INDEX submission_primary_uq ON submission_participants (submission_id) WHERE is_primary;
CREATE INDEX ON submission_participants (event_id, contact_id);

CREATE TABLE submission_answers (             -- CFP answers: one row per field (× participant)
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL,
  submission_id  uuid NOT NULL,
  field_id       uuid NOT NULL REFERENCES form_fields(id),   -- fields are soft-deleted, FK always holds
  participant_id uuid,                        -- NULL = abstract-section answer
  value          jsonb NOT NULL,              -- shape by field_type, see §5.4
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (submission_id, event_id)  REFERENCES submissions(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (participant_id, event_id) REFERENCES submission_participants(id, event_id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (submission_id, field_id, participant_id)   -- PG15+; upsert target
);

CREATE TABLE submission_tags (
  event_id      uuid NOT NULL,
  submission_id uuid NOT NULL,
  tag_id        uuid NOT NULL,
  PRIMARY KEY (submission_id, tag_id),
  FOREIGN KEY (submission_id, event_id) REFERENCES submissions(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id, event_id)        REFERENCES tags(id, event_id)        ON DELETE CASCADE
);
```

`code` assignment + deadline + limit enforcement all live in `createSubmission` inside `withTx`:
```sql
-- inside one transaction (websocket driver):
SELECT * FROM events WHERE id = $eventId FOR UPDATE;          -- serializes per-event submits
-- check closes_at > now() on the form row; count submitted rows only
-- (status NOT IN ('draft','withdrawn'); drafts never consume the limit)
-- by (submitter_contact_id, form_id) vs COALESCE(form.submission_limit, event.submission_cap_per_user)
-- lock and promote the caller's existing draft while keeping its code; otherwise:
UPDATE events SET submission_seq = submission_seq + 1 WHERE id = $eventId RETURNING submission_seq;
INSERT INTO submissions (..., code) VALUES (..., seq);
INSERT INTO submission_answers ...;
INSERT INTO communication_logs (status='queued', idempotency_key = event_id::text||':received:'||submission_id::text, ...);
```
The event-row lock closes the two-tab double-submit race completely; contention is per-event and acceptable.

### 3.6 Evaluation & scoring

```sql
CREATE TABLE evaluation_plans (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name      text NOT NULL,
  round     int  NOT NULL DEFAULT 1,          -- "multiple rounds" = ordered plans
  scale_min int  NOT NULL DEFAULT 1,
  scale_max int  NOT NULL DEFAULT 5,
  status    plan_status NOT NULL DEFAULT 'open',
  track_ids uuid[],                           -- NULL = all tracks (category scope)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name),
  UNIQUE (id, event_id),
  CHECK (scale_max > scale_min)
);

CREATE TABLE evaluation_criteria (            -- optional; a plan with 0 criteria = single overall score
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  plan_id  uuid NOT NULL,
  label    text NOT NULL,
  weight   numeric NOT NULL DEFAULT 1,
  sort_order int NOT NULL DEFAULT 0,
  FOREIGN KEY (plan_id, event_id) REFERENCES evaluation_plans(id, event_id) ON DELETE CASCADE
);

CREATE TABLE reviewer_assignments (           -- category-based routing of reviewers
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  uuid NOT NULL,
  plan_id   uuid NOT NULL,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  track_ids uuid[],                           -- NULL = all tracks in plan scope
  FOREIGN KEY (plan_id, event_id) REFERENCES evaluation_plans(id, event_id) ON DELETE CASCADE,
  UNIQUE (plan_id, user_id)
);

CREATE TABLE reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL,
  plan_id          uuid NOT NULL,
  submission_id    uuid NOT NULL,
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  overall_score    numeric,                   -- NULL = comment-only / in progress
  criterion_scores jsonb NOT NULL DEFAULT '{}',   -- {criterionId: number}
  comment          text,
  is_ai            boolean NOT NULL DEFAULT false, -- optional AI reviewer writes ordinary rows
  submitted_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (plan_id, event_id)       REFERENCES evaluation_plans(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (submission_id, event_id) REFERENCES submissions(id, event_id)      ON DELETE CASCADE,
  UNIQUE (plan_id, submission_id, reviewer_user_id)   -- upsert target: resubmit updates
);
CREATE INDEX ON reviews (event_id, submission_id);
```

Rating aggregate (nulls excluded, never treated as 0) is the `submission_ratings_v` view in §6.

### 3.7 Agenda

```sql
CREATE TABLE sessions (                       -- the schedulable program session
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  submission_id uuid UNIQUE,                  -- accepted abstract this was promoted from
  title         text NOT NULL,
  slug          text NOT NULL,
  description_html text,
  format_id     uuid,
  track_id      uuid,
  room_id       uuid,
  starts_at     timestamptz,                  -- NULL pair = unscheduled tray
  ends_at       timestamptz,
  status        session_status NOT NULL DEFAULT 'draft',
  schedule_revision int NOT NULL DEFAULT 0,   -- bumped on time/room change → ICS SEQUENCE + schedule_changed email
  row_version   int NOT NULL DEFAULT 1,       -- optimistic CAS for concurrent drags
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, slug),
  UNIQUE (id, event_id),
  FOREIGN KEY (submission_id, event_id) REFERENCES submissions(id, event_id)     ON DELETE SET NULL (submission_id),
  FOREIGN KEY (format_id, event_id)     REFERENCES session_formats(id, event_id) ON DELETE SET NULL (format_id),
  FOREIGN KEY (track_id, event_id)      REFERENCES tracks(id, event_id)          ON DELETE SET NULL (track_id),
  FOREIGN KEY (room_id, event_id)       REFERENCES rooms(id, event_id)           ON DELETE SET NULL (room_id),
  CHECK ((starts_at IS NULL) = (ends_at IS NULL)),
  CHECK (starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX ON sessions (event_id, starts_at);
CREATE INDEX ON sessions (event_id, room_id, starts_at);
CREATE INDEX ON sessions (event_id, status);

CREATE TABLE session_speakers (
  event_id   uuid NOT NULL,
  session_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  role       participant_role NOT NULL DEFAULT 'speaker',
  sort_order int NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, contact_id),
  FOREIGN KEY (session_id, event_id) REFERENCES sessions(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE CASCADE
);
CREATE INDEX ON session_speakers (event_id, contact_id);
```

Conflicts are **derived, never stored**: pure `detectConflicts(sessions: ScheduledSession[]): Conflict[]` in `features/agenda/conflicts.ts` — half-open `[start, end)` intervals, sort+sweep O(n log n); room overlap = error, speaker overlap = error, track overlap = warning. Unit-tested first; run client-side for live badges and server-side on every `moveSession` write (authoritative for the Conflicts tab). Deleting a room/track SET NULLs sessions in place (they become partially-unscheduled, never orphaned).

Room/track deletes, `ON DELETE SET NULL (col)` column-list syntax: PG15+. NEEDS-VERIFY drizzle-kit emits it; if not, replace those FKs with plain `ON DELETE SET NULL` after making `event_id` nullable-safe via trigger — fallback: enforce in repo functions and drop the composite FK to vocab tables only (keep plain FK on id). Decide at migration-0000 time; do not let this block.

### 3.8 Portal: tasks, responses, uploads, resources

```sql
CREATE TABLE file_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title            text NOT NULL,
  target_type      task_target NOT NULL DEFAULT 'contact',
  instructions_html text,
  accepted_extensions text[] NOT NULL DEFAULT '{pdf,ppt,pptx,key,zip,png,jpg,jpeg}',
  max_size_mb      int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, event_id)
);

CREATE TABLE portal_tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name             text NOT NULL,
  description_html text,
  target_type      task_target NOT NULL DEFAULT 'contact',
  completion_mode  task_mode NOT NULL DEFAULT 'manual',
  form_id          uuid,                      -- portal form (context='portal')
  file_request_id  uuid,
  due_at           timestamptz,               -- date-only input → end-of-day in event tz, converted in app
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, event_id),
  FOREIGN KEY (form_id, event_id)         REFERENCES forms(id, event_id)         ON DELETE RESTRICT,
  FOREIGN KEY (file_request_id, event_id) REFERENCES file_requests(id, event_id) ON DELETE RESTRICT,
  CHECK ((completion_mode = 'form')         = (form_id IS NOT NULL)),
  CHECK ((completion_mode = 'file_request') = (file_request_id IS NOT NULL))
);
-- RESTRICT: deleting a form/file-request referenced by a task is blocked (revert task to manual first).

CREATE TABLE task_completions (               -- assignments are LAZY (view §6); only completions are rows
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL,
  task_id        uuid NOT NULL,
  contact_id     uuid NOT NULL,
  submission_id  uuid,                        -- set iff task.target_type='submission'
  completed_via  completion_via NOT NULL,
  form_response_id uuid,
  file_upload_id   uuid,
  completed_by_user_id uuid REFERENCES users(id),   -- admin override attribution
  completed_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, event_id)       REFERENCES portal_tasks(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, event_id)    REFERENCES contacts(id, event_id)     ON DELETE CASCADE,
  FOREIGN KEY (submission_id, event_id) REFERENCES submissions(id, event_id)  ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (task_id, contact_id, submission_id)  -- idempotent complete; ON CONFLICT DO NOTHING
);
CREATE INDEX ON task_completions (event_id, contact_id);

CREATE TABLE form_responses (                 -- portal-form answers (CFP answers use submission_answers)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL,
  form_id       uuid NOT NULL,
  form_version  int NOT NULL,
  contact_id    uuid NOT NULL,
  submission_id uuid,
  answers       jsonb NOT NULL DEFAULT '{}',  -- {fieldId: value}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (form_id, event_id)       REFERENCES forms(id, event_id)       ON DELETE CASCADE,
  FOREIGN KEY (contact_id, event_id)    REFERENCES contacts(id, event_id)    ON DELETE CASCADE,
  FOREIGN KEY (submission_id, event_id) REFERENCES submissions(id, event_id) ON DELETE CASCADE,
  UNIQUE NULLS NOT DISTINCT (form_id, contact_id, submission_id)   -- one response per target; resubmit = upsert overwrite
);

CREATE TABLE file_uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL,
  file_request_id uuid NOT NULL,
  contact_id      uuid NOT NULL,
  submission_id   uuid,
  file_asset_id   uuid NOT NULL REFERENCES file_assets(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (file_request_id, event_id) REFERENCES file_requests(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, event_id)      REFERENCES contacts(id, event_id)      ON DELETE CASCADE,
  FOREIGN KEY (submission_id, event_id)   REFERENCES submissions(id, event_id)   ON DELETE CASCADE
);
CREATE INDEX ON file_uploads (file_request_id, contact_id);

CREATE TABLE resource_pages (                 -- portal wiki; body allows sanitized iframe embeds
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title      text NOT NULL,
  slug       text NOT NULL,
  body_html  text,
  sort_order int NOT NULL DEFAULT 0,
  published  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, slug)
);
```

Write-back rule (form task with `maps_to` fields): update **only the columns present in the form**, never whole-row overwrite; runs in `completeTaskViaResponse` transaction after the response upsert. Co-speaker policy: **submission tasks belong to the primary contact only** (documented; prevents dashboard double-count).

### 3.9 Embeds

```sql
CREATE TABLE embeds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- doubles as unguessable public token
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name         text NOT NULL,
  content_type embed_content_type NOT NULL,
  enabled      boolean NOT NULL DEFAULT true,               -- gates serving (disabled → empty shell)
  style        jsonb NOT NULL DEFAULT '{}',   -- {accent, theme:'light'|'dark', showHeader}
  filters      jsonb NOT NULL DEFAULT '{}',   -- {trackIds?, day?}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Canonical public pages (`/e/[slug]/schedule`, `/e/[slug]/speakers`) read only the `published_*_v` views (§6) — draft leakage is prevented at the view layer, not per-callsite.

### 3.10 Communications

```sql
CREATE TABLE email_templates (                -- seeded 8 rows per event on event create (one per template_key value, incl. portal_login)
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  key       template_key NOT NULL,
  subject   text NOT NULL,
  body_html text NOT NULL,                    -- {{var}} merge tags; unknown vars rejected at save
  enabled   boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, key)
);

CREATE TABLE reminder_rules (                 -- offsets relative to task due_at; seeded -7, -1, +1
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  offset_days int NOT NULL,                   -- negative = before due
  enabled     boolean NOT NULL DEFAULT true,
  UNIQUE (event_id, offset_days)
);

CREATE TABLE communication_logs (             -- transactional OUTBOX + audit trail
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL,
  template_key    template_key NOT NULL,
  idempotency_key text NOT NULL UNIQUE,       -- THE double-send guard; insert-first, unique-violation = already handled
  status          comm_status NOT NULL DEFAULT 'queued',
  subject_rendered text,
  body_rendered_html text,
  secret_payload_ciphertext bytea,            -- portal_login only; AES-GCM, cleared after dispatch
  error           text,
  provider_message_id text,
  ics_uid         text,
  attempts        int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  submission_id   uuid,
  session_id      uuid,
  task_id         uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  FOREIGN KEY (contact_id, event_id)    REFERENCES contacts(id, event_id)     ON DELETE CASCADE,
  FOREIGN KEY (submission_id, event_id) REFERENCES submissions(id, event_id)  ON DELETE SET NULL (submission_id),
  FOREIGN KEY (session_id, event_id)    REFERENCES sessions(id, event_id)     ON DELETE SET NULL (session_id),
  FOREIGN KEY (task_id, event_id)       REFERENCES portal_tasks(id, event_id) ON DELETE SET NULL (task_id)
);
CREATE INDEX ON communication_logs (event_id, status) WHERE status = 'queued';
CREATE INDEX ON communication_logs (event_id, contact_id, created_at DESC);

CREATE TABLE calendar_invites (               -- ICS state per speaker × session
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL,
  contact_id  uuid NOT NULL,
  session_id  uuid NOT NULL,
  ics_uid     text NOT NULL UNIQUE,           -- stable: 'sb-{sessionId}-{contactId}@{sendingDomain}'
  sequence    int NOT NULL DEFAULT 0,         -- bumped every REQUEST after the first; monotonic
  last_method ics_method NOT NULL DEFAULT 'request',
  organizer_email text NOT NULL,              -- stamped on first send; byte-stable for this UID
  last_sent_at timestamptz,
  FOREIGN KEY (contact_id, event_id) REFERENCES contacts(id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, event_id) REFERENCES sessions(id, event_id) ON DELETE CASCADE,
  UNIQUE (contact_id, session_id)
);
```

Idempotency-key recipe (deterministic, event-scoped, collision-free by construction):
- `{eventId}:received:{submissionId}`
- `{eventId}:decision:{submissionId}:{notify_revision}`
- `{eventId}:task_assigned:{taskId}:{contactId}:{submissionId|-}`
- `{eventId}:task_reminder:{taskId}:{contactId}:{submissionId|-}:{offset_days}`
- `{eventId}:task_reminder:{taskId}:{contactId}:{submissionId|-}:manual:{minuteBucket}`
- `{eventId}:sched:{sessionId}:{contactId}:{schedule_revision}`
- `{eventId}:portal_login:{contactId}:{tokenId}`

Send pipeline: domain writes insert `queued` rows transactionally (outbox) → the separate
`sb-jobs` worker POSTs `/api/jobs/outbox` on `sb-web` every minute → the web comms dispatcher
claims bounded rows, rebuilds truth from entity ids, renders escaped templates, sends through
Resend, and updates `sent`/`failed`/`skipped`. A best-effort `ctx.waitUntil` nudge may reduce
latency but never supplies correctness. `EMAIL_MODE=log|send` prevents real sends in local/
preview. `/api/jobs/reminders` runs every 15 minutes by minute modulo; it scans the live
assignment view, chooses only the latest eligible rung, and rechecks openness at dispatch.

### 3.11 Airtable sync state

```sql
CREATE TABLE airtable_sync_state (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  table_name         text NOT NULL,           -- 'speakers'|'submissions'|'sessions'|'task_status'
  record_pk          text NOT NULL,           -- uuid or composite ('taskId:contactId:subId') as text
  airtable_record_id text NOT NULL,
  content_hash       text NOT NULL,
  last_synced_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, table_name, record_pk)   -- event-scoped: identical record keys from two events must not collide; every lookup/upsert includes event_id
);

CREATE TABLE airtable_sync_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  trigger     text NOT NULL CHECK (trigger IN ('manual','cron')),
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','failed')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  stats       jsonb NOT NULL DEFAULT '{}',    -- {created, updated, skipped, errors} per table
  error       text
);
```

---

## 4. Lifecycle state machines

### 4.1 Submission (the contract 5+ modules share)

States: `draft → pending → {accept_queue | decline_queue | accepted | declined} → withdrawn`, matching Sessionboard's 8 tabs (All = everything; the other 7 are the enum).

Allowed transitions (also encoded as `SUBMISSION_TRANSITIONS` map in `src/shared/contracts/transitions.ts` — single source for UI, route-handler mutations, and the trigger below):

| From \ To | pending | accept_queue | decline_queue | accepted | declined | withdrawn |
|---|---|---|---|---|---|---|
| draft | ✅ submit | — | — | — | — | ✅ speaker |
| pending | — | ✅ | ✅ | ✅ direct | ✅ direct | ✅ speaker |
| accept_queue | ✅ undo | — | ✅ | ✅ **notify** | ✅ | ✅ |
| decline_queue | ✅ undo | ✅ | — | ✅ | ✅ **notify** | ✅ |
| accepted | ✅ undo | ✅ | ✅ | — | ✅ reversal | ✅ |
| declined | ✅ undo | ✅ | ✅ | ✅ reversal | — | — |
| withdrawn | ✅ admin restore | — | — | — | — | — |

Admin inline editor moves freely among the 5 decision states (matches the popover screenshot). Speaker-side rules (enforced in portal route-handler mutations, not the trigger): speakers may only `draft→pending` and `*→withdrawn`; queue states render as **Pending** in the portal (never leaked).

DB enforcement — belt-and-suspenders against parallel agents writing raw updates:

```sql
CREATE OR REPLACE FUNCTION trg_submission_status_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (CASE OLD.status
    WHEN 'draft'         THEN NEW.status IN ('pending','withdrawn')
    WHEN 'pending'       THEN NEW.status IN ('accept_queue','decline_queue','accepted','declined','withdrawn')
    WHEN 'accept_queue'  THEN NEW.status IN ('pending','decline_queue','accepted','declined','withdrawn')
    WHEN 'decline_queue' THEN NEW.status IN ('pending','accept_queue','accepted','declined','withdrawn')
    WHEN 'accepted'      THEN NEW.status IN ('pending','accept_queue','decline_queue','declined','withdrawn')
    WHEN 'declined'      THEN NEW.status IN ('pending','accept_queue','decline_queue','accepted')
    WHEN 'withdrawn'     THEN NEW.status IN ('pending')
  END) THEN
    RAISE EXCEPTION 'illegal submission transition % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'draft' AND NEW.submitted_at IS NULL THEN NEW.submitted_at := now(); END IF;
  IF NEW.status = 'withdrawn' AND NEW.withdrawn_at IS NULL THEN NEW.withdrawn_at := now(); END IF;
  IF NEW.status IN ('accept_queue','decline_queue','accepted','declined') AND NEW.decided_at IS NULL
    THEN NEW.decided_at := now(); END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER submission_status_guard BEFORE UPDATE OF status ON submissions
  FOR EACH ROW EXECUTE FUNCTION trg_submission_status_guard();
```

Application layer additionally uses guarded updates (`... WHERE status = $expected`) so the *loser* of a concurrent decision changes nothing and fires no email. **Notify** (`notifyDecisions`, in `withTx`):

```sql
UPDATE submissions SET status = 'accepted', notified_at = now(), row_version = row_version + 1
WHERE id = ANY($ids) AND event_id = $eventId
  AND status = 'accept_queue' AND notified_at IS NULL
RETURNING id;   -- outbox rows inserted only for RETURNING ids → double-notify sends nothing
```

Side effects on entering `accepted`: outbox `submission_accepted` email (with portal magic link); task assignments need **no** materialization (lazy view); promotion to a `sessions` row is an explicit organizer action ("Add to agenda"), not automatic.

### 4.2 Speaker (contact)

Two independent axes, deliberately simple:
- `confirmation_status`: `unconfirmed → confirmed | declined`, admin/speaker can flip any direction (no trigger; guarded update). Feeds the dashboard confirmation-mix donut and gallery filter (gallery shows confirmed speakers on published sessions).
- Portal access: derived — a contact can log in once they exist (submitter) ; "accepted speaker" is always **derived** as `EXISTS accepted submission` (`accepted_speakers_v`), never a stored flag that can drift.

### 4.3 Task assignment

Assignment rows are virtual (`task_assignments_v`): state `open → completed` is the existence of a `task_completions` row; `overdue` = open ∧ `due_at < now()`. Transitions:
- complete: `INSERT ... ON CONFLICT (task_id, contact_id, submission_id) DO NOTHING` (idempotent; via manual click, form response, file upload, or admin) — inserted in the same transaction as the response/upload row, after it.
- reopen (admin only): `DELETE FROM task_completions WHERE ...`. Reminders resume automatically (idempotency keys already used stay used — acceptable: no re-nag after reopen; documented).
Late-accepted speakers appear in the view instantly; un-accepting removes their open tasks from every aggregate with zero cleanup.

### 4.4 Form and session (minor machines)

- Form: `draft → open → closed → open`. Effective openness = `status = 'open' AND (closes_at IS NULL OR closes_at > now()) AND (opens_at IS NULL OR opens_at <= now())` — computed in `is_form_open()` SQL + shared TS; the status column stores admin intent, `closes_at` wins. Close blocks **new and edited** submissions (both paths call the same guard).
- Session: `draft ↔ published`. Any change to `starts_at/ends_at/room_id` on a **published** session bumps `schedule_revision` (repo function) → `schedule_changed` outbox + ICS SEQUENCE bump; unscheduling/unpublishing a published session with sent invites → `METHOD:CANCEL` outbox.

---

## 5. Form schema representation, versioning, conditions, answers

### 5.1 Authoring rows + immutable published snapshots

Two layers, one engine (`features/forms-engine`):

1. **Authoring source of truth** = `form_sections` + `form_fields` rows (editable in the builder; `form_fields.id` immutable; delete = soft-delete `deleted_at`).
2. **Runtime source of truth** = `form_versions.snapshot` (jsonb) — compiled at every builder **Save** by `compileFormSnapshot(formId)`: reads live rows, validates (visibility sources must reference *earlier* non-deleted fields → cycles impossible by construction; dropdown option ids unique; locked-field invariants: Title / First / Last / Email present, required, correct type — server rejects the save otherwise), writes version `current_version + 1`, updates `forms.current_version`. Versions are append-only and never edited.

The public wizard and the portal task-form renderer fetch the **latest** snapshot; drafts and responses pin the version they started against (`submissions.form_version`, `form_responses.form_version`) and are validated at submit **against their pinned snapshot** — a mid-flight builder edit can never orphan an in-progress draft or make a submitted answer un-renderable. Admin review renders answers against the pinned snapshot (labels from history), with soft-deleted fields' answers still readable.

Version churn (one per save) is fine: snapshots are small (< 50 KB), and the snapshot doubles as an edge-cacheable payload for the public CFP page (cache key includes version; openness checked at request time, never cached past `closes_at`).

Snapshot TS shape (zod in `src/shared/contracts/forms.ts`, used verbatim client + server):

```ts
type FormSnapshot = {
  formId: string; version: number; context: "cfp" | "portal";
  sections: Array<{
    id: string; key: string; title: string; pageHeading: string; descriptionHtml: string | null;
    fields: Array<{
      id: string; key: string; label: string; type: FieldType;
      required: boolean; locked: boolean; maxChars: number | null; helpText: string | null;
      options: Array<{ id: string; label: string; trackId?: string; formatId?: string; tagId?: string }> | null;
      visibility: VisibilityRule | null;
      mapsTo: MapsToTarget | null;
    }>;
  }>;
};
```

### 5.2 Conditional logic — one evaluator, zero drift

```ts
type Condition = {
  sourceFieldId: string;                    // must be an EARLIER field (enforced at compile)
  op: "eq" | "neq" | "in" | "contains" | "answered" | "empty";
  value?: string | string[];                // option IDs for choice fields, never labels
};
type VisibilityRule = { match: "all" | "any"; conditions: Condition[] };

// src/shared/contracts/form-logic.ts — THE only implementation, imported by
// the wizard (live show/hide), the server validator, and the routing engine.
function isVisible(field, answers: Record<string, AnswerValue>): boolean;
function evaluateRule(rule: VisibilityRule, answers): boolean;
```

Server-side submit pipeline (in `createSubmission` / `completeTaskViaResponse`):
1. Load pinned snapshot. 2. Compute the visible field set from the submitted answers via `isVisible` (never trust client visibility claims). 3. **Discard** answers to hidden or soft-deleted or unknown fields. 4. Validate required/max-chars/type only over visible fields. 5. Apply `maps_to` write-backs to typed columns. 6. Run `routing_rules` (ordered, first enabled match via the same `evaluateRule`) → stamp `track_id` / insert `submission_tags`; no match → `track_id` stays NULL = "Uncategorized" bucket (renders "-", filterable).

Single-level conditions only (no rule referencing a conditionally-hidden field's *visibility*, just its answer — hidden ⇒ `answered=false`), matching the brief and the compile-time earlier-field restriction.

### 5.3 Why answers are asymmetric (deliberate)

- **CFP** (`submission_answers`, row per field × participant): the abstracts table filters/sorts/exports per-question, Airtable export flattens columns, and per-participant answers (bio per co-speaker) need the extra dimension. `UNIQUE NULLS NOT DISTINCT (submission_id, field_id, participant_id)` makes draft autosave a clean upsert.
- **Portal forms** (`form_responses.answers` jsonb): one blob per (form, contact[, submission]), overwritten on resubmit; nobody queries individual portal answers — the queryable output is the `maps_to` write-back onto `contacts`/`submissions`.

Answer `value` jsonb shapes by type (zod-validated): text/textarea/richtext/email/phone/url → `{"t":"s","v":string}`; number → `{"t":"n","v":number}`; date → `{"t":"d","v":"YYYY-MM-DD"}`; dropdown/radio → `{"t":"opt","v":optionId}`; multiselect/checkbox → `{"t":"opts","v":optionId[]}`; file → `{"t":"file","v":fileAssetId}`. Discriminated by `t` so renderers never guess.

---

## 6. Read-model views (the dashboard/gallery/API contract)

Defined in a custom migration; **one counting rule** lives here and nowhere else. The dashboard, public API, and embeds modules may read *only* these views (plus `published_*_v`), never raw tables.

```sql
CREATE VIEW accepted_speakers_v AS
SELECT DISTINCT sp.event_id, sp.contact_id
FROM submission_participants sp
JOIN submissions s ON s.id = sp.submission_id
WHERE s.status = 'accepted';

CREATE VIEW task_assignments_v AS               -- LAZY assignments; the onboarding source of truth
WITH targets AS (
  SELECT t.id AS task_id, t.event_id, a.contact_id, NULL::uuid AS submission_id, t.due_at
  FROM portal_tasks t
  JOIN accepted_speakers_v a ON a.event_id = t.event_id
  WHERE t.target_type = 'contact' AND t.is_active
  UNION ALL
  SELECT t.id, t.event_id, sp.contact_id, s.id, t.due_at
  FROM portal_tasks t
  JOIN submissions s  ON s.event_id = t.event_id AND s.status = 'accepted'
  JOIN submission_participants sp ON sp.submission_id = s.id AND sp.is_primary
  WHERE t.target_type = 'submission' AND t.is_active
)
SELECT tg.*, (tc.id IS NOT NULL) AS completed, tc.completed_at, tc.completed_via,
       (tc.id IS NULL AND tg.due_at IS NOT NULL AND tg.due_at < now()) AS overdue
FROM targets tg
LEFT JOIN task_completions tc
       ON tc.task_id = tg.task_id AND tc.contact_id = tg.contact_id
      AND tc.submission_id IS NOT DISTINCT FROM tg.submission_id;

CREATE VIEW speaker_outstanding_v AS            -- CORE dashboard: ranked outstanding/overdue per speaker
SELECT event_id, contact_id,
       count(*) FILTER (WHERE NOT completed) AS open_count,
       count(*) FILTER (WHERE overdue)       AS overdue_count,
       count(*) FILTER (WHERE completed)     AS done_count
FROM task_assignments_v GROUP BY event_id, contact_id;

CREATE VIEW missing_assets_v AS                 -- accepted speakers missing bio/headshot
SELECT c.event_id, c.id AS contact_id,
       (c.bio_html IS NULL OR btrim(regexp_replace(c.bio_html, '<[^>]*>', '', 'g')) = '') AS missing_bio,
       (c.headshot_file_id IS NULL) AS missing_headshot
FROM contacts c JOIN accepted_speakers_v a ON a.contact_id = c.id;

CREATE VIEW submission_status_counts_v AS       -- tabs + KPI tiles; THE counting rule
SELECT event_id, status, count(*) AS n FROM submissions GROUP BY event_id, status;
-- Rule: "Submissions" KPI = sum where status <> 'draft'; tabs show per-status n; All = sum(all).

CREATE VIEW submission_ratings_v AS             -- nulls excluded; no-score rows absent (render '-', sort last)
SELECT event_id, submission_id, plan_id,
       avg(overall_score) AS rating, count(overall_score) AS n_scores
FROM reviews WHERE overall_score IS NOT NULL
GROUP BY event_id, submission_id, plan_id;

CREATE VIEW published_sessions_v AS             -- the ONLY read path for embeds/public API
SELECT s.id, s.event_id, s.title, s.slug, s.description_html, s.starts_at, s.ends_at,
       s.track_id, t.name AS track_name, t.color AS track_color,
       s.room_id, r.name AS room_name, s.format_id, f.name AS format_name
FROM sessions s
LEFT JOIN tracks t          ON t.id = s.track_id
LEFT JOIN rooms r           ON r.id = s.room_id
LEFT JOIN session_formats f ON f.id = s.format_id
WHERE s.status = 'published' AND s.starts_at IS NOT NULL;

CREATE VIEW published_speakers_v AS             -- gallery: confirmed speakers on published sessions
SELECT DISTINCT c.event_id, c.id AS contact_id, c.first_name, c.last_name, c.job_title,
       c.company, c.bio_html, c.headshot_file_id, c.linkedin_url, c.twitter_url, c.website_url
FROM contacts c
JOIN session_speakers ss ON ss.contact_id = c.id
JOIN sessions s ON s.id = ss.session_id AND s.status = 'published'
WHERE c.confirmation_status = 'confirmed';
```

Day-grouping of the schedule happens in SQL/TS **in the event's IANA timezone** (`starts_at AT TIME ZONE e.timezone`), never `DATE(starts_at)` in UTC.

---

## 7. Airtable one-way export

Position: Postgres is the source of truth; Airtable is a read-only mirror for bonus points. Export is **async, idempotent, rate-limited, and never in the request path**.

**Exported tables & field mapping** (base configured via `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`; table names fixed):

| Airtable table | Source | Fields | record_pk |
|---|---|---|---|
| `Speakers` | `contacts` ∩ `accepted_speakers_v` | Name, Email, Company, Job Title, Bio (plaintext-stripped), Headshot URL (public R2 URL), Confirmation, Open Tasks (from `speaker_outstanding_v`), PG ID | contact id |
| `Submissions` | `submissions` (all non-draft) | Code ("SESS-n"), Title, Status, Kind, Track (name), Tags (multi), Format, Rating (from `submission_ratings_v`), Submitter Email, Speakers (names joined "; "), Submitted At, Notified At, PG ID | submission id |
| `Sessions` | `published_sessions_v` + speakers | Title, Day (event-tz date), Starts, Ends, Room, Track, Speakers, PG ID | session id |
| `Task Status` | `task_assignments_v` | Task, Speaker, Submission Code, Due, Status (Open/Completed/Overdue), Completed At | `taskId:contactId:{subId|-}` |
| `Comms Log` (optional) | `communication_logs` | Recipient, Template, Status, Sent At | log id |

**Trigger**: admin "Sync to Airtable" button (`POST` → insert `airtable_sync_runs` row → run in `ctx.waitUntil`) + the shared jobs worker's `%10 === 5` route trigger when `AIRTABLE_CRON=1`. Single-flight: refuse to start if a `running` row younger than 10 min exists. Airtable configuration remains on `sb-web`; `sb-jobs` only sends the authenticated HTTP tick.

**Algorithm** (per table, in `features/airtable-export`):
1. Query source rows (views above — status filtering for free: session-like tables export accepted/published only, by construction).
2. For each row build the Airtable field payload; `content_hash = sha256(canonical json)`.
3. Diff against `airtable_sync_state`: unknown pk → create; known + hash changed → update by `airtable_record_id`; hash equal → skip.
4. Batch 10 records/request (Airtable max), throttle ≥ 275 ms between requests (< 4 rps against the 5 rps limit), retry once on 429 with backoff.
5. Upsert `airtable_sync_state` rows; finish run with per-table `{created, updated, skipped, errors}` stats surfaced in admin.

**Idempotency**: re-running is a no-op (hash skip); a crashed run resumes safely because state rows are written per-batch. **Deletions are not propagated** (documented append/update-only mirror); withdrawn submissions export with Status=Withdrawn, so nothing misleading lingers. Airtable-side edits are overwritten on next sync (one-way, stated in admin UI).

---

## 8. Multi-event scoping, soft delete, audit

**Scoping** (top cross-agent bug risk):
1. `event_id NOT NULL` on all 30 event-scoped tables; `ON DELETE CASCADE` from `events`.
2. `UNIQUE (id, event_id)` + composite FKs (Section 2.3) — cross-event references are a constraint violation, not a code-review hope.
3. Repository layer: every exported query function's first parameter is `eventId` (no default, no optional). Public routes resolve slug → event once in a layout-level loader and pass the id down.
4. Every unique business key includes `event_id` (`(event_id, email)`, `(event_id, slug)`, `(event_id, code)`, `(event_id, name)`).
5. No Postgres RLS — single-tenant admin team, 4.5 days; the composite-FK net plus repo signatures is the right cost/benefit. Portal IDOR safety comes from `portal_sessions` binding (contact_id, event_id) and every portal query filtering by both.

**Soft delete** — only where history depends on it:
- `form_fields.deleted_at` (answers must survive; runtime + builder filter it out). That's it.
- Everything else: hard delete with explicit FK behavior — vocab deletes SET NULL onto submissions/sessions (rows become "Uncategorized"/unscheduled, never orphaned); form/file-request deletes are RESTRICTed while a task references them; submissions are never deleted through the UI (withdraw is the status); contacts are never deleted (no UI); `events` delete cascades everything (dev convenience).
- Recoverability net for demos: Neon point-in-time restore / branch — free, zero code.

**Audit** — deliberately minimal: `created_at/updated_at` everywhere, `communication_logs` (who was emailed what, when — the trust-critical audit), `airtable_sync_runs`, `task_completions.completed_by_user_id` and `completed_via`, `portal_sessions.impersonated_by_user_id` (impersonated writes attributable), `form_versions.published_by`. No generic audit_log table — zero judged value for its cost.

---

## 9. Migration workflow for parallel agents

The failure mode to prevent: N agents generating drizzle migrations concurrently → interleaved journal, conflicting DDL, broken deploys.

**Rules (put verbatim in CLAUDE.md / each agent's brief):**
1. **Migration 0000 is big-bang**: this entire document (tables §3, trigger §4, views §6) lands as `drizzle/0000_init.sql` + `drizzle/0001_views_triggers.sql` (custom migration for plpgsql/views, generated with `drizzle-kit generate --custom`) **before any feature agent starts**. The schema is designed to be complete; the target is *zero* schema changes during the build.
2. **Schema owner**: one designated role (the integrator/human). Drizzle schema lives in `src/db/schema/{core,forms,submissions,evaluation,agenda,portal,comms,airtable}.ts` — one file per module so PRs rarely collide. Feature agents may *propose* a change by editing their module's schema file in a PR, but **only the schema owner runs `drizzle-kit generate`, only on main, serially**. Agent-generated files under `drizzle/` are rejected in review.
3. **Additive-only after day 0**: new nullable columns, new tables, new indexes OK; renames/drops/type-changes forbidden (ship a new column instead). Enum changes: `ADD VALUE` only, schema owner only.
4. `drizzle-kit push` is banned (silent drift); the only paths are `pnpm db:generate` (owner) and `pnpm db:migrate` (everyone/CI, runs `drizzle-orm/migrator` against `DATABASE_URL`).
5. **Neon environments:** use `sb-dev`, `sb-test`, and `sb-prod`. Agents share `sb-dev`; Playwright/CI reset only `sb-test`; production is never a test target. Disposable branches are allowed for destructive migration experiments, not required per-agent ceremony. The deterministic seed contains 8 templates (7 domain keys + `portal_login`).
6. **Contracts freeze**: `src/shared/contracts/` (enums, lifecycle maps, FormSnapshot/Condition zod, DTOs derived via `drizzle-zod`, `limits.ts`, `form-logic.ts` evaluator) is written by the schema owner on day 0 and versioned with the schema; feature agents import, never edit.

---

## 10. NEEDS-VERIFY checklist (all day-0, all cheap)

1. **`withTx` smoke test**: `@neondatabase/serverless` `Pool` + interactive transaction inside a deployed OpenNext-on-Cloudflare route handler, including one invocation reached through an `sb-jobs` POST. The jobs worker itself never receives a DB URL. Verify before anything builds on the eight audited functions.
2. **Neon PG version ≥ 15** for `UNIQUE NULLS NOT DISTINCT` and column-list `ON DELETE SET NULL (col)`; and that current **drizzle-kit** emits both (`nullsNotDistinct()` is supported; the FK column-list form may need the custom-migration escape hatch — fine, it's in 0001 anyway).
3. **ICS lifecycle on Workers**: use the binding hand-rolled UTC-`Z` builder decision; test import in Gmail *and* Outlook, including recipient-matching ATTENDEE, byte-stable ORGANIZER, SEQUENCE bump, and METHOD:CANCEL.
4. **HTML sanitizer on Workers**: confirm the `xss` package bundles/runs; wire into `src/shared/lib/sanitize.ts` day 0 since every `*_html` column depends on the invariant.
5. **OpenNext caching**: ISR/tag revalidation behavior on the Cloudflare adapter for the public CFP/schedule/gallery pages; fallback `Cache-Control: s-maxage=60` + version-keyed snapshot fetch. Affects read path only — no schema impact either way.
6. **Resend domain verification** before judging; `EMAIL_MODE=log` default everywhere except prod.
