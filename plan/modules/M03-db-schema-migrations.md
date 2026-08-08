# M03 — DB schema, migrations, views, transition trigger

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED-PARTIAL** SQL migrations and a tracked Drizzle migration journal/runner exist; nothing has been applied to Neon and the nine integration AC still require proof. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-A Platform & Foundation (architect — **sole schema owner** for the whole build) |
| **Scheduled** | Fri Aug 8 evening (DDL transcription draft) → **Sat AM: applied to sb-dev + sb-test + sb-prod before any feature work** → FROZEN at CP1 Sat noon, additive-only thereafter |
| **Size** | L |
| **Paths owned** | `src/db/client.ts`, `src/db/schema/*.ts`, `src/db/schema/index.ts`, `src/db/views.ts`, `drizzle/0000_init.sql`, `drizzle/0001_views_triggers.sql`, `drizzle/meta/**`, `scripts/db/migrate.ts`, `tests/integration/schema.test.ts` |

## Objective
The entire database exists exactly once, as two big-bang migrations applied to all three Neon databases, with Drizzle table objects and view types importable by every feature. Illegal submission transitions raise at the DB level, cross-event joins are constraint violations, and the eight read views are the only read path for dashboard/embeds/public API. After this lands, six feature agents can write queries in parallel against a schema that will not move.

## Dependencies
- **Hard (blocks start):** [M02](./M02-shared-contracts.md)'s `src/shared/contracts/enums.ts` — the const arrays that feed every `pgEnum`. Do not hand-write enum values in the schema files.
- **Soft (start against stub/fixture):** [M01](./M01-scaffold-ci-deploy.md)'s spike **S2** verdict (Neon WebSocket `Pool` on the deployed Worker). The DDL is identical either way; only `withTx`'s implementation branches. Transcribe the DDL tonight regardless of S2's outcome; wire `withTx` when the verdict lands.

## Provides (interfaces others consume)
- `import { db, withTx, type TxDb } from '@/db/client'` — **lint-enforced to `features/*/server/**`, `src/db/**`, `src/shared/server/**`, `scripts/seed/**` only** ([M01](./M01-scaffold-ci-deploy.md) grep + boundaries).
- `import { events, contacts, submissions, … } from '@/db/schema'` — one file per feature; a feature imports **only its own** schema file plus vocab it reads through another feature's barrel.
- View row types in `src/db/views.ts`: `AcceptedSpeakerRow`, `TaskAssignmentRow`, `SpeakerOutstandingRow`, `MissingAssetsRow`, `SubmissionStatusCountRow`, `SubmissionRatingRow`, `PublishedSessionRow`, `PublishedSpeakerRow`.
- **`is_form_open(p_form_id uuid) → boolean`** SQL function in `0001` (PROPOSED placement — migrations are architect-only, so the SQL half must ship here). **It takes a uuid, not a composite `forms` row** — every call site ([M14](./M14-form-settings-notifications.md) Step 6, [M16](./M16-submit-pipeline.md), [M18](./M18-submission-mutations-notify.md) step 3.2, [M41](./M41-speaker-edit-until-close.md) step 2b) writes `is_form_open(formId)`, and a row-typed signature would make every one of them a `function is_form_open(uuid) does not exist` error inside the audited `createSubmission` transaction. [M14](./M14-form-settings-notifications.md) owns the TS twin and the UI; [M16](./M16-submit-pipeline.md)/[M41](./M41-speaker-edit-until-close.md) call the SQL half inside their guards.
- `pnpm db:migrate` (everyone, CI) and `pnpm db:generate` (**architect only, on main, serially**).
- Consumed by: [M06a](./M06a-admin-auth.md), [M06b](./M06b-portal-auth.md), [M07](./M07-r2-storage.md), [M09](./M09-seed-demo-script.md), [M11](./M11-events-feature.md), [M16](./M16-submit-pipeline.md), [M17](./M17-abstracts-table.md), [M18](./M18-submission-mutations-notify.md), [M19](./M19-evaluation-scoring.md), [M23](./M23-tasks-admin.md), [M25](./M25-task-runtime.md), [M27](./M27-speakers-admin.md), [M28](./M28-sessions-crud.md), [M32](./M32-public-schedule-gallery.md), [M34](./M34-comms-outbox-dispatcher.md), [M36](./M36-reminder-scan.md), [M38](./M38-dashboard.md), [M39](./M39-airtable-export.md).

## Step-by-step implementation

### 1. CONTRACT-FIRST SLICE — `src/db/client.ts` + empty schema barrel, first commit
Files: `src/db/client.ts`, `src/db/schema/index.ts`.
```ts
export const db = drizzle(neon(getEnv().DATABASE_URL), { schema });      // neon-http: all reads + single-statement writes
export async function withTx<T>(fn: (tx: TxDb) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: getEnv().DATABASE_URL });
  try { return await drizzleWs(pool, { schema }).transaction(fn); }
  finally { await pool.end(); }
}
export type TxDb = Parameters<Parameters<typeof withTx>[0]>[0];
```
`withTx` is confined to **eight** audited runtime call sites (resolution #4): `requestPortalLogin`, `createSubmission`, `upsertDraft`, `updateSubmissionFromCfp`, `notifyDecisions`, `completeTaskViaResponse`, `completeTaskViaUpload`, and `moveSession`. Put that list in a doc comment at the top of the file. Every other deployed write is a single statement (guarded UPDATE, `ON CONFLICT` upsert, CTE insert); M09's CLI seed orchestrator is the documented non-runtime exception.
- **Done when:** `import { db, withTx } from '@/db/client'` typechecks from a scratch `features/x/server/probe.ts` and fails lint from `src/app/page.tsx`.

### 2. Enum declarations from the contracts arrays
File: `src/db/schema/enums.ts`.
```ts
import { SUBMISSION_STATUSES } from '@/shared/contracts';
export const submissionStatus = pgEnum('submission_status', SUBMISSION_STATUSES);
```
All 20 enums from data-model.md **§3.0 Enums**, each sourced from its const array. `field_type` keeps **all 13** values (extensible; only the 8 committed types are built — see [M02](./M02-shared-contracts.md) §1).
- **Done when:** `grep -c "pgEnum(" src/db/schema/enums.ts` = 20 and none contains a string literal array.

### 3. Table transcription — one schema file per feature, mirroring the DDL 1:1
Transcribe from data-model.md's numbered DDL sections. **Read each section; do not improvise columns.**

| Schema file | Tables | DDL source |
|---|---|---|
| `core.ts` | `users`, `events`, `event_members`, `file_assets`, `tracks`, `rooms`, `session_formats`, `tags` | §3.1 Identity & events, §3.2 Program vocabulary |
| `contacts.ts` | `contacts`, `portal_tokens` ★, `portal_sessions`, `api_keys` | §3.3 Contacts (speakers) & portal auth |
| `forms.ts` | `forms` ★, `form_sections`, `form_fields`, `form_versions`, `routing_rules` | §3.4 Form engine |
| `submissions.ts` | `submissions` ★, `submission_participants`, `submission_answers`, `submission_tags` | §3.5 Submissions (abstracts) |
| `evaluation.ts` | `evaluation_plans`, `evaluation_criteria`, `reviewer_assignments`, `reviews` | §3.6 Evaluation & scoring |
| `agenda.ts` | `sessions`, `session_speakers` | §3.7 Agenda |
| `portal.ts` | `file_requests`, `portal_tasks`, `task_completions`, `form_responses`, `file_uploads`, `resource_pages` | §3.8 Portal: tasks, responses, uploads, resources |
| `embeds.ts` | `embeds` | §3.9 Embeds |
| `comms.ts` | `email_templates`, `reminder_rules`, `communication_logs`, `calendar_invites` | §3.10 Communications |
| `airtable.ts` | `airtable_sync_state`, `airtable_sync_runs` | §3.11 Airtable sync state |
| `auth.ts` | better-auth's own tables (or the resolution-#11 fallback's `admin_sessions`) | see [M06a](./M06a-admin-auth.md) / spike S4 |

Conventions applied to **every** event-scoped table (data-model §2): `id uuid PK DEFAULT gen_random_uuid()`, `created_at`/`updated_at timestamptz NOT NULL DEFAULT now()`, `event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE`, **`UNIQUE (id, event_id)`**, and **every inter-table FK composite `(x_id, event_id) REFERENCES x(id, event_id)`**. `row_version int NOT NULL DEFAULT 1` on `events`, `forms`, `submissions`, `sessions`. Emails `CHECK (email = lower(btrim(email)))`.

**Per-table load-bearing details** (the ones an implementer gets wrong from memory — everything else follows the DDL):

- `users` — email UNIQUE + lower-trim CHECK, `password_hash` nullable.
- `events` — `slug` UNIQUE with **both** the regex CHECK `^[a-z0-9](-?[a-z0-9])*$` and the reserved-word CHECK (`api, submit, admin, portal, e, embed, assets, app, cal, f, login` — **11 values, byte-identical to [M04](./M04-shared-libs.md)'s `RESERVED_SLUGS` array and [M11](./M11-events-feature.md)'s app-side list**; `cal`/`f`/`login` are exactly the prefixes that would collide with [M35](./M35-ics-calendar-invites.md)'s `/cal/[token]`, [M07](./M07-r2-storage.md)'s `/f/[fileId]` and [M06a](./M06a-admin-auth.md)'s `/login`); `timezone` IANA text; `theme` ≤1000 CHECK; `submission_cap_per_user` default **3**; **`submission_seq`** (the SESS-n counter, bumped inside `createSubmission`); `logo_file_id`/`background_file_id` FKs added **after** `file_assets` exists (circular).
- `event_members` — PK `(user_id, event_id)`, `role` ∈ owner|organizer|reviewer. This is the only role source; [M06a](./M06a-admin-auth.md) reads it.
- `file_assets` — `r2_key` UNIQUE, `mime`/`size_bytes` server-validated, `uploaded_by_contact_id` FK added after `contacts` (circular).
- `tracks`/`rooms`/`session_formats`/`tags` — `UNIQUE (event_id, name)` each; `tracks.color` hex default `#6366f1`; `session_formats.default_duration_mins` default 30. **One vocabulary** shared by CFP dropdowns, routing, evaluation scope, agenda and embeds — options reference **ids**, never labels, so renames never orphan rules.
- `contacts` — **`UNIQUE (event_id, email)`** (per-event identity; no global speaker), `bio_html` sanitized ≤5000 plaintext (app-enforced), `confirmation_status` default `unconfirmed`, `unsubscribed_at` suppresses **reminder-class mail only**.
- `portal_tokens` ★2 — `token_hash` UNIQUE plus nullable `otp_hash` (sha256; raw values never stored), `purpose`, `expires_at`, `consumed_at` (NULL forever for `ics_download`), **`attempts`**.
- `portal_sessions` — `token_hash` UNIQUE, composite FK to `(contact_id, event_id)`, `impersonated_by_user_id`.
- `forms` ★7 ★8 — `id` doubles as the public URL token; `context` cfp|portal; `page_heading varchar(15)`; `closes_at` (**closes new AND updated submissions**); `submission_limit` NULL → event cap; `participant_roles jsonb`; `target_type` required when `context='portal'` (CHECK); `current_version` (0 = never published).
- `form_fields` — **immutable `id`** (answers key on it); `locked` (Title/First/Last/Email); `options jsonb` carrying `trackId`/`formatId`/`tagId`; `visibility jsonb` (the rule AST); `maps_to` closed allowlist; **`deleted_at` soft delete**; `UNIQUE (form_id, key) WHERE deleted_at IS NULL`.
- `form_versions` — append-only, `UNIQUE (form_id, version)`, `snapshot jsonb` written **only** by `compileFormSnapshot` ([M04](./M04-shared-libs.md)).
- `routing_rules` — ordered `sort_order`, `match` all|any, `conditions jsonb` (same shape as visibility), `set_track_id`, `add_tag_ids uuid[]`, `enabled`.
- `submissions` ★1 ★3 — `UNIQUE (event_id, code)`; `form_version` pinned; 7-state `status`; `source` cfp|manual|import; `title varchar(255)`; `notified_at`; **`notify_revision`**; `withdrawn_at`; five composite FKs with the column-list `ON DELETE SET NULL (col)` form; indexes on `(event_id, status)`, `(event_id, form_id)`, `(event_id, track_id)`, `(event_id, submitter_contact_id)`, `(event_id, submitted_at DESC NULLS LAST)`.
- `submission_participants` — `UNIQUE (submission_id, contact_id)` **plus the partial unique `ON (submission_id) WHERE is_primary`** — this is what makes the resolution-#14 fan-out well-defined.
- `submission_answers` — **`UNIQUE NULLS NOT DISTINCT (submission_id, field_id, participant_id)`** (the draft-upsert target); `value jsonb` discriminated by `t`; FK to `form_fields(id)` holds through soft delete.
- `evaluation_plans` — `round int`, `scale_min/max` CHECK, `track_ids uuid[]` (NULL = all). `reviewer_assignments` — `UNIQUE (plan_id, user_id)`, `track_ids[]` = category routing. `reviews` — **`UNIQUE (plan_id, submission_id, reviewer_user_id)`** (the upsert target), `overall_score` nullable, `is_ai`.
- `sessions` — `submission_id UNIQUE` (the promotion link), `UNIQUE (event_id, slug)`, **`CHECK ((starts_at IS NULL) = (ends_at IS NULL))`** and `CHECK (starts_at IS NULL OR ends_at > starts_at)` (the unscheduled tray is a both-NULL pair), **`schedule_revision`** (→ ICS SEQUENCE), `row_version` (the drag CAS).
- `portal_tasks` — `completion_mode` with the two CHECK-paired columns (`(mode='form') = (form_id IS NOT NULL)`, same for `file_request`), both FKs **`ON DELETE RESTRICT`** ("revert task to manual first"), `due_at` = end-of-day in event tz written by the app, `created_at` (used by [M36](./M36-reminder-scan.md)'s suppression rule).
- `task_completions` — **`UNIQUE NULLS NOT DISTINCT (task_id, contact_id, submission_id)`** (idempotent complete; `ON CONFLICT DO NOTHING`). Assignments are **lazy view rows**; only completions are stored.
- `form_responses` — **`UNIQUE NULLS NOT DISTINCT (form_id, contact_id, submission_id)`** (resubmit = overwrite), `answers jsonb`, `form_version` pinned.
- `communication_logs` ★9 — **`idempotency_key` UNIQUE** (insert-first = the double-send firewall), `status` queued|sent|failed|**skipped**, `attempts`/`next_attempt_at`/`locked_until` (the `FOR UPDATE SKIP LOCKED` claim), `subject_rendered`/`body_rendered_html`, `secret_payload_ciphertext` (nullable; encrypted `portal_login` only, cleared after dispatch), `provider_message_id`, `ics_uid`, entity refs, partial index `(event_id, status) WHERE status='queued'` and `(event_id, contact_id, created_at DESC)`.
- `calendar_invites` — `UNIQUE (contact_id, session_id)`, `ics_uid` UNIQUE and **stable**, `sequence` monotonic, `last_method` request|cancel, and `organizer_email` stamped on first send and never overwritten.
- `airtable_sync_state` — `UNIQUE (table_name, record_pk)` → `airtable_record_id`, `content_hash`.

- **Done when:** `pnpm db:generate` emits `0000_init.sql` and a diff-read against data-model.md §3 shows no missing column, no missing UNIQUE, and no plain FK where a composite is specified.

### 4. The ★ review deltas — all of them land in 0000/0001 **before** the Sat-noon freeze
These are the binding review additions/removals already folded into data-model.md; the table
exists as the migration audit checklist. Each item is load-bearing for a named module.

| ★ | Change | Why / who needs it |
|---|---|---|
| ★1 | `submissions.notify_revision int NOT NULL DEFAULT 0` | part of the decision idempotency key; makes re-notify after organizer undo possible → [M18](./M18-submission-mutations-notify.md), [M34](./M34-comms-outbox-dispatcher.md) |
| ★2 | `portal_tokens.attempts int NOT NULL DEFAULT 0` + nullable `otp_hash` | OTP brute-force guard and hash-only OTP lookup: 5 failed verifies → token consumed → [M06b](./M06b-portal-auth.md) |
| ★3 | `CREATE UNIQUE INDEX submissions_one_draft_uq ON submissions (form_id, submitter_contact_id) WHERE status = 'draft'` | **one server draft per (contact, form)** → [M15](./M15-public-cfp-wizard.md), [M16](./M16-submit-pipeline.md), [M18](./M18-submission-mutations-notify.md) |
| ★4 | Every Airtable-exported view exposes `greatest(a.updated_at, b.updated_at, …) AS updated_at` | [M39](./M39-airtable-export.md)'s watermark must never skip rows whose freshness comes from a joined table |
| ★5 | `task_assignments_v` bakes in the resolution-#14 fan-out rule, with the rule text as a SQL comment | [M23](./M23-tasks-admin.md), [M25](./M25-task-runtime.md), [M36](./M36-reminder-scan.md), [M38](./M38-dashboard.md) consume it and never re-derive |
| ★6 | Trigger clears `notified_at` and bumps `notify_revision` when a row **leaves** `accepted`/`declined` | organizer-undo → re-notify produces a distinct idempotency key → [M18](./M18-submission-mutations-notify.md) |
| ★7 | `forms.allow_multiple_drafts` **removed** | single draft by construction (★3) |
| ★8 | `forms.cross_field_limits`, `forms.admin_alert_new_user_ids`, `forms.admin_alert_updated_user_ids` **removed** | never-build list (PLAN §1) + [M14](./M14-form-settings-notifications.md)'s cut; unbuilt columns invite improvisation |
| ★9 | `communication_logs` carries `attempts`, `next_attempt_at`, `locked_until`, `body_rendered_html`, nullable `secret_payload_ciphertext`, plus `status='skipped'`. **`comm_status` stays exactly `('queued','sent','failed','skipped')` — there is no `sending` value**; [M34](./M34-comms-outbox-dispatcher.md)'s claim keeps `status='queued'` and claims purely via `locked_until`. Ciphertext is legal only for `portal_login`, cleared on terminal dispatch, and its production body is redacted | dispatcher claim/backoff + secure auth delivery/audit → [M06b](./M06b-portal-auth.md), [M34](./M34-comms-outbox-dispatcher.md), [M37](./M37-comms-admin-ui.md) |
| ★10 | `template_key` pgEnum gains an **8th** value `portal_login` (additive `ADD VALUE`) | [M06b](./M06b-portal-auth.md)'s OTP / magic-link mail goes through the one outbox path; `magic_link` is not and never was a template key → [M02](./M02-shared-contracts.md) §1, [M34](./M34-comms-outbox-dispatcher.md), [M37](./M37-comms-admin-ui.md) |

`contacts.confirmation_status` needs no DDL change but carries a comment: *"auto-set to `confirmed` by `notifyDecisions` on the primary contact of each accepted submission (resolution #15); admin overrides in [M27](./M27-speakers-admin.md)."*
- **Done when:** each ★ appears in `0000`/`0001` and is greppable by its name.

### 5. `drizzle/0000_init.sql` — big-bang, generated once
Generate with `drizzle-kit generate`, then hand-patch the two PG15+ forms drizzle-kit may not emit: `UNIQUE NULLS NOT DISTINCT (…)` and the column-list `ON DELETE SET NULL (col)` on composite FKs (data-model §3.7 flags this as NEEDS-VERIFY). If drizzle-kit cannot emit the column-list form, move those FK statements into `0001` as raw SQL — do not weaken `event_id` to nullable, and do not drop the composite FK.
- **Done when:** `psql $DATABASE_URL_DIRECT -f drizzle/0000_init.sql` applies to an empty Neon branch with zero errors.

### 6. `drizzle/0001_views_triggers.sql` — trigger + `is_form_open()` + the 8 views
**6a. Transition guard** — transcribe `trg_submission_status_guard()` from data-model.md **§4.1 Submission (the contract 5+ modules share)** verbatim, then append ★6 before `RETURN NEW`:
```sql
IF OLD.status IN ('accepted','declined') AND NEW.status NOT IN ('accepted','declined') THEN
  NEW.notified_at := NULL;
  NEW.notify_revision := OLD.notify_revision + 1;
END IF;
```
The CASE arms must match [M02](./M02-shared-contracts.md)'s `SUBMISSION_TRANSITIONS` map exactly — a test asserts it (§8).

**6b. `is_form_open`** — **uuid argument**, so every caller can write `is_form_open(formId)`:
```sql
CREATE FUNCTION is_form_open(p_form_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT f.status = 'open'
     AND (f.opens_at  IS NULL OR f.opens_at  <= now())
     AND (f.closes_at IS NULL OR f.closes_at >  now())
  FROM forms f WHERE f.id = p_form_id;
$$;
```
Closing blocks **new AND updated** submissions — submit ([M16](./M16-submit-pipeline.md)), draft-convert, and speaker edit ([M41](./M41-speaker-edit-until-close.md)) all call this one predicate against the **DB clock**, never a client clock.

**6c. The eight views** — transcribe from data-model.md **§6 Read-model views**, adding ★4's `updated_at` aggregates and ★5's comment:
1. `accepted_speakers_v` — DISTINCT (event_id, contact_id) over participants of `status='accepted'` submissions. + `max(s.updated_at) AS updated_at`.
2. `task_assignments_v` — the lazy assignment engine. `targets` CTE = (contact-targeted tasks × `accepted_speakers_v`) UNION ALL (submission-targeted tasks × accepted submissions **joined to `submission_participants` on `is_primary`**), LEFT JOIN `task_completions` on `(task, contact, submission IS NOT DISTINCT FROM)`; exposes `completed`, `completed_at`, `completed_via`, `overdue = (not completed AND due_at IS NOT NULL AND due_at < now())`, and `greatest(t.updated_at, tc.completed_at, s.updated_at) AS updated_at`. **SQL comment carries the fan-out rule text verbatim.**
3. `speaker_outstanding_v` — per (event, contact): `open_count`, `overdue_count`, `done_count` over view 2.
4. `missing_assets_v` — accepted speakers with `missing_bio` (whitespace-after-tag-strip counts as missing) and `missing_headshot`.
5. `submission_status_counts_v` — `(event_id, status, count(*))`. Comment: *"Submissions KPI = sum where status <> 'draft'; tabs show per-status n; All = sum(all)."* THE counting rule.
6. `submission_ratings_v` — `avg(overall_score)`, `count(overall_score)` over `reviews WHERE overall_score IS NOT NULL` (nulls excluded, never treated as 0; absent rows render "—" and sort last).
7. `published_sessions_v` — published sessions with non-null `starts_at`, joined to track/room/format names+colors; + `greatest(s.updated_at, t.updated_at, r.updated_at, f.updated_at) AS updated_at`.
8. `published_speakers_v` — DISTINCT confirmed contacts on published sessions; + `greatest(c.updated_at, s.updated_at) AS updated_at`. **The confirmed-only filter is what makes [M27](./M27-speakers-admin.md)'s "declined" override remove a speaker from the public gallery** (resolution #15; [M32](./M32-public-schedule-gallery.md) has the leakage test).
- **Done when:** all 8 views exist (`SELECT count(*) FROM pg_views WHERE viewname LIKE '%_v'` = 8) and each returns 0 rows without error on an empty DB.

### 7. Apply to all three databases
`pnpm db:migrate` against `sb-dev`, then `sb-test`, then `sb-prod` — using `DATABASE_URL_DIRECT` (non-pooled) for migrations. Record all three connection strings' project ids in `DECISIONS.md`.
Post-apply assertions on each: `SHOW server_version` ≥ 15; `SELECT count(*) FROM information_schema.tables WHERE table_schema='public'`.
- **Done when:** the same table count is reported by all three, pasted into `DECISIONS.md` under `## CP1 freeze record`.

### 8. `tests/integration/schema.test.ts` — PGlite, the invariants that matter
Apply `0000` + `0001` to PGlite in `beforeAll` (this doubles as the deferred "PGlite schema compat" spike). Tests:
1. **Trigger parity:** for all 49 `(from,to)` pairs, attempt the UPDATE; assert success ⟺ `canTransition(from,to)` from [M02](./M02-shared-contracts.md).
2. **Illegal transition raises** with SQLSTATE `23514`.
3. **★6:** `accepted → pending` clears `notified_at` and increments `notify_revision` in the same statement.
4. **Cross-event composite FK:** inserting a submission in event A referencing a track from event B fails.
5. **`UNIQUE NULLS NOT DISTINCT`:** two `submission_answers` rows with the same `(submission_id, field_id)` and NULL `participant_id` collide.
6. **★3:** a second `status='draft'` row for the same `(form_id, submitter_contact_id)` fails; a `pending` row alongside a `draft` succeeds.
7. **★5 fan-out:** a submission with a primary + a co-speaker, a submission-targeted task → **exactly one** `task_assignments_v` row.
8. **`is_form_open`:** `closes_at` one second in the past → false.
9. **Leakage:** a draft session and an unconfirmed speaker are absent from `published_sessions_v` / `published_speakers_v`.
- **Done when:** `pnpm vitest run tests/integration/schema.test.ts` is green (9 tests).

### 9. Freeze + the additive-only rule (post-CP1)
Publish in `DECISIONS.md`: *new nullable columns, new tables, new indexes are allowed via an architect-labeled PR; renames, drops and type-changes are forbidden — ship a new column instead. Enum changes: `ADD VALUE` only. `drizzle-kit push` is banned (grep #10). Agent-generated files under `drizzle/` are rejected in review.*

## Acceptance criteria
Catalog AC, verbatim: *migrations apply cleanly to fresh Neon + PGlite; illegal status transition raises; accepted→pending clears notified_at and bumps notify_revision atomically; cross-event composite-FK insert fails; `UNIQUE NULLS NOT DISTINCT` works (PG≥15 verified); co-speakered submission yields exactly one `task_assignments_v` row.*

```bash
pnpm db:migrate                                     # against each of sb-dev / sb-test / sb-prod
pnpm vitest run tests/integration/schema.test.ts    # 9 invariants
psql "$DATABASE_URL_DIRECT" -c "select count(*) from pg_views where viewname like '%\_v'"   # 8
psql "$DATABASE_URL_DIRECT" -c "show server_version"                                        # >= 15
psql "$DATABASE_URL_DIRECT" -c "update submissions set status='accepted' where status='draft'"  # ERROR 23514
```

## Guardrails
- **Single-writer schema.** Only the architect runs `drizzle-kit generate`, only on `main`, serially. Feature agents may *propose* a column by editing their own `src/db/schema/<feature>.ts` in a PR; they never touch `drizzle/`. This kills the interleaved-journal failure mode that six parallel agents otherwise guarantee.
- **Event scoping is impossible-by-construction, not a code-review hope** (data-model §8): `event_id NOT NULL` + `UNIQUE(id, event_id)` on all 30 event-scoped tables; every inter-table FK composite. If a composite FK is inconvenient, the query is wrong — do not weaken the constraint.
- **The trigger is a backstop, not the mechanism.** Application writes are guarded `UPDATE … WHERE status = $expected`; the loser of a race changes nothing and fires nothing ([M18](./M18-submission-mutations-notify.md)). The trigger catches raw writes from an agent who skipped the repo function.
- **`withTx` is confined to eight runtime functions.** A ninth deployed transactional path is a design change requiring the architect. M09's command-line seed transaction is the sole non-runtime exception. If spike S2 failed, those eight runtime paths become single-statement guarded CTEs — the schema does not change either way.
- **Views are the only read path** for [M38](./M38-dashboard.md), [M32](./M32-public-schedule-gallery.md), [M33](./M33-embed-shells.md), [M39](./M39-airtable-export.md), [M40](./M40-public-api.md). One counting rule, draft-leak-proof by construction. A dashboard widget querying `submissions` directly is a review-blocker.
- **Timezone edge case:** every instant column is `timestamptz`; day-grouping happens in the event's IANA zone via [M04](./M04-shared-libs.md)'s `eventDayKey`, **never** `DATE(starts_at)` in UTC. A 9 PM Pacific session must bin to the correct event day.
- **Empty-state edge case:** every view must return 0 rows (not error) for the seeded empty second event — [M09](./M09-seed-demo-script.md)'s standing empty-state test depends on it.
- **Concurrent-edit edge case:** `row_version` exists on `events`, `forms`, `submissions`, `sessions` for the 409 path (R11). Rows without it are single-owner surfaces by design (profile fields) — do not add optimistic concurrency ad hoc.
- Cascade behavior is designed, not incidental: vocab deletes `SET NULL` onto submissions/sessions (rows become "Uncategorized"/unscheduled, never orphaned); `portal_tasks → forms/file_requests` is `RESTRICT` (delete blocked with "revert task to manual first"); `events` cascades everything.

## If blocked
- **Neon not reachable:** apply `0000`/`0001` to PGlite and write all 9 integration tests — that is the majority of the value and it runs offline. Apply to Neon the moment it is up.
- **drizzle-kit refuses a PG15 form:** move that statement into `0001` as raw SQL (it is a `--custom` migration; plpgsql and views already live there) and keep going. Do not redesign the constraint.
- **S2 (Pool) verdict still pending:** implement `withTx` against the Pool anyway; the fallback rewrite is inside the eight consumers, not here.
- **Schema done early:** write the `src/db/views.ts` typed row helpers, then start [M04](./M04-shared-libs.md)'s `time.ts` DST table — it is the next thing every workstream needs.
