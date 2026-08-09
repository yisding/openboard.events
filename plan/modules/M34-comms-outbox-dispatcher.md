# M34 — Comms core: outbox dispatcher + template renderer

| | |
|---|---|
| **Status** | NOT STARTED |
| **Workstream / executing agent** | WS-F (Comms + Dashboard + Airtable + API) — feature folder `comms`. |
| **Scheduled** | **Sat AM start (right after [M08](./M08-jobs-worker.md)), finished Sat PM.** The Sat-PM WS-F checklist items ([M35](./M35-ics-calendar-invites.md)'s canned ICS curl, [M39](./M39-airtable-export.md)'s Airtable provisioning) run interleaved. |
| **Size** | L (≈1 day) |
| **Paths owned** | `src/features/comms/index.ts` (**the WS-F barrel — M34 creates and owns it; [M35](./M35-ics-calendar-invites.md)/[M36](./M36-reminder-scan.md)/[M37](./M37-comms-admin-ui.md) may only append their named export lines**), `src/features/comms/server/dispatcher.ts`, `src/features/comms/server/render.ts`, `src/features/comms/server/context.ts`, `src/features/comms/server/templates.ts`, `src/features/comms/server/resend.ts`, `src/features/comms/server/layout.ts`, `src/features/comms/server/queries.ts`, `src/features/comms/render.test.ts`, `src/features/comms/dispatcher.test.ts`, `scripts/seed/comms.ts` |

## Objective
The judged email path exists end to end: any feature can `enqueueEmail(tx, …)` inside its own transaction, and a minute later the dispatcher claims that outbox row, rebuilds its render context from entity **ids** (never a stale payload), mints a fresh portal magic link, renders a validated `{{var}}` template into HTML + plain text, sends it through Resend with an `Idempotency-Key`, and stores the rendered subject/body on the log row. `EMAIL_MODE=log` makes all of this demoable with zero real sends. `seedDefaultTemplates(dbOrTx, eventId)` is the single owner of the **8** default template rows and the 3 reminder rungs.

## Dependencies
- **Hard (blocks start):**
  - [M03](./M03-db-schema-migrations.md) — `communication_logs` (incl. the ★ deltas `attempts`, `next_attempt_at`, `locked_until`, `subject_rendered`, `body_rendered_html`, `status` with `skipped`), `email_templates`, `reminder_rules`, `contacts`, `events` migrated on **sb-dev** (and sb-test); `comm_status`/`template_key` pgEnums exist.
  - [M04](./M04-shared-libs.md) — `enqueueEmail(tx, {eventId, templateKey, contactId, idempotencyKey, refs, secretPayloadCiphertext?})`, `getEnv()` (`EMAIL_MODE`, `EMAIL_ALLOWLIST`, `EMAIL_FROM`, `RESEND_API_KEY`, `APP_BASE_URL`), `sanitize()`, `time.ts`'s `formatInZone`, `errors.ts`.
  - [M02](./M02-shared-contracts.md) — `TEMPLATE_KEYS` const array, `TemplateVars` per key, the idempotency-key recipes, `CommLogRow` DTO.
  - [M08](./M08-jobs-worker.md) — `POST /api/jobs/outbox` route + `defineJobRoute` (the wiring target).
- **Soft (start against stub/fixture):**
  - `issuePortalToken(dbOrTx, {contactId, eventId, purpose, ttl, withOtp?}): Promise<{tokenId, raw, otp?, expiresAt}>` ([M06b](./M06b-portal-auth.md), lands Sat PM) — a Phase-0 throwing stub exists in contracts. Ordinary links omit `withOtp` and destructure `raw`; `portal_login` has already been issued by M06b and arrives only as an encrypted delivery payload. Until auth lands, keep dependent rows in log mode rather than inventing an unhashed token. **Swap step:** import from `@/features/auth`.
  - Real outbox rows from [M16](./M16-submit-pipeline.md)/[M18](./M18-submission-mutations-notify.md)/[M28](./M28-sessions-crud.md) arrive only Sat PM–Sun. Until then use **`scripts/seed/comms.ts`** (this module writes it): 8 `queued` rows across all 8 template keys against seeded contacts/submissions, incl. one row whose submission title is the hostile `;lkj` / `<img onerror=alert(1)>` seed string and one row for a contact with `unsubscribed_at` set.
  - Resend domain may be unverified until Sun noon — that changes nothing here (`EMAIL_MODE=log` is the dev default; prod flips at the Sun-noon decision point).

## Provides (interfaces others consume)
Verbatim from PLAN §4/M34 where specified; PROPOSED where derived.

```ts
// src/features/comms/index.ts  (the WS-F barrel)
import type { JobName, JobStats } from '@/shared/contracts';   // contracts/jobs.ts — NEVER from src/app/api/jobs/_lib.ts
export async function dispatchOutbox(budget: number): Promise<JobStats>;              // wired to POST /api/jobs/outbox (M08)
export function renderTemplate(key: TemplateKey, vars: TemplateVars): { subject: string; html: string; text: string };
export function validateTemplateBody(key: TemplateKey, subject: string, body: string): { ok: true } | { ok: false; unknownTokens: string[] };
export async function seedDefaultTemplates(dbOrTx: DbOrTx, eventId: EventId): Promise<void>;  // ALSO seeds reminder_rules -7/-1/+1  (PROPOSED)
export async function listLog(eventId: EventId, filters?: CommLogFilters): Promise<CommLogRow[]>;
export type CommLogFilters = { contactId?: ContactId; templateKey?: TemplateKey; status?: CommStatus; limit?: number }; // PROPOSED
```

- `seedDefaultTemplates` → consumed by [M11](./M11-events-feature.md) (event-create mutation) and [M09](./M09-seed-demo-script.md)'s orchestrator. **It is the only code in the repo that inserts `email_templates` or `reminder_rules` rows** (PLAN §3).
- `listLog` / `CommLogRow` → consumed by [M27](./M27-speakers-admin.md) (per-speaker comms history, fixture rows until this lands), [M37](./M37-comms-admin-ui.md) (log table), [M40](./M40-public-api.md) (`/comms-log` keyed endpoint).
- `dispatchOutbox` → consumed by [M08](./M08-jobs-worker.md) and by [M36](./M36-reminder-scan.md)'s `nudgeOutbox`.
- `renderTemplate` / `validateTemplateBody` → consumed by [M37](./M37-comms-admin-ui.md) (save-time validation + preview).
- Internal-only (not exported from the barrel; imported by [M35](./M35-ics-calendar-invites.md) via a direct same-feature import): `buildContext(row): Promise<TemplateVars>` in `server/context.ts`, `sendViaResend(msg)` in `server/resend.ts`.

## Step-by-step implementation

1. **Contract-first slice (do this first, before any dispatcher internals).** Create `src/features/comms/index.ts` exporting every signature above, with `renderTemplate`/`validateTemplateBody` real (they are pure and cheap) and `dispatchOutbox`/`listLog` throwing `new Error('NOT_IMPLEMENTED')`. Implement `seedDefaultTemplates` **for real in this step** — [M11](./M11-events-feature.md) is blocked on it from Sat AM.
   - `server/templates.ts`: `DEFAULT_TEMPLATES: Record<TemplateKey, {subject: string; bodyHtml: string}>`. Write these **eight** verbatim so no agent invents copy (bodies are short `<p>`-only HTML; every token below must exist in that key's contract):
     | key | default subject | body gist (tokens used) |
     |---|---|---|
     | `submission_received` | `We received your submission — {{submission.title}}` | thanks + `{{submission.code}}` + "track it in your portal" `{{portal.magic_link}}` |
     | `submission_accepted` | `Your session was accepted for {{event.name}}` | congrats + `{{submission.title}}` + next steps + `{{portal.magic_link}}` |
     | `submission_declined` | `An update on your submission to {{event.name}}` | polite decline + `{{submission.title}}` |
     | `task_assigned` | `New task for {{event.name}}: {{task.name}}` | `{{task.name}}`, due `{{task.due_date}}`, `{{portal.magic_link}}` |
     | `task_reminder` | `Reminder: {{task.name}} is due {{task.due_date}}` | `{{tasks.outstanding_list}}` + `{{portal.magic_link}}` + `{{unsubscribe.url}}` |
     | `schedule_assigned` | `You're scheduled: {{session.title}}` | `{{session.start_time_local}}`–`{{session.end_time_local}}` `{{session.timezone}}` in `{{session.room}}`, calendar buttons |
     | `schedule_changed` | `Updated time for {{session.title}}` | same fields, "your calendar invite has been updated" |
     | `portal_login` | `Your sign-in code for {{event.name}}` | `{{speaker.first_name}}`, the 6-digit `{{otp.code}}`, and `{{portal.magic_link}}` as the one-tap alternative |
     The **8th key `portal_login`** exists because [M06b](./M06b-portal-auth.md)'s OTP / magic-link mail goes through this one outbox path ([M02](./M02-shared-contracts.md) §1, [M03](./M03-db-schema-migrations.md) ★10). It is the **one documented exception to resolution #12**: M06b calls `issuePortalToken(..., {withOtp:true})`, seals `{otp, magicLink}` as the **v1 `portal_login` envelope** ([M06b](./M06b-portal-auth.md) §3 defines it byte-for-byte: `[0x01 ‖ 12-byte nonce ‖ AES-256-GCM ct+tag]`, HKDF-SHA-256 key from `SESSION_SECRET` with info `"portal_login-v1"`, AAD `eventId:contactId:tokenId`), and stores only the ciphertext on the outbox row. `buildContext` opens it just-in-time via `openPortalLoginPayload` imported from `@/features/auth` (one shared implementation — this module never re-derives the crypto), never logs it, and clears `secret_payload_ciphertext` after render/send. Dispatcher tests cover a tampered ciphertext byte (GCM auth failure → row `failed`, ciphertext cleared, no crash) and an unknown version byte (row `failed`, batch continues). In production, persist a redacted `body_rendered_html` for this key so the comms log never becomes a live-token viewer; preview log mode may retain the rendered body only while `EMAIL_FALLBACK_UI=1`.
     **`seedDefaultTemplates(dbOrTx: DbOrTx, eventId: EventId)`** (the `DbOrTx` union from [M02](./M02-shared-contracts.md) §11 — [M11](./M11-events-feature.md)'s event-create calls it on the neon-http `db` handle rather than opening another `withTx`, and the seed orchestrator calls it with its CLI transaction; one signature, both call sites) = one `INSERT … SELECT` over the **8** rows with `ON CONFLICT (event_id, key) DO NOTHING`, plus `INSERT INTO reminder_rules (event_id, offset_days, enabled) VALUES (-7,true),(-1,true),(1,true) ON CONFLICT (event_id, offset_days) DO NOTHING`. It must be safe to call on an event that already has templates (it is what makes [M09](./M09-seed-demo-script.md) re-runnable).
   **Done when:** `pnpm vitest run src/features/comms/render.test.ts` compiles; calling `seedDefaultTemplates` twice for one event leaves exactly **8** `email_templates` + 3 `reminder_rules` rows (PGlite test); `@/features/comms` type-checks from [M11](./M11-events-feature.md)'s import site.
2. **The mustache-subset renderer** — `server/render.ts`, ~80 lines, zero deps.
   - Grammar: `{{ dot.path }}` only. **No** conditionals, loops, partials, or triple-stache. Regex `\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}`.
   - Resolution: walk the dot path over the vars object. `undefined`, `null`, or `''` → **throw** `AppError('TEMPLATE_VAR_MISSING', 'missing variable speaker.first_name')`. Never emit `undefined` or leave the raw token.
   - Escaping: every resolved value is HTML-escaped (`& < > " '`). **One exception**, the pre-escaped allowlist `PRE_ESCAPED = new Set(['tasks.outstanding_list', 'calendar.buttons_html'])` — these are built by *our* `context.ts` out of already-escaped pieces (platform-integrations §5.5). Adding to this set requires a comment naming the builder function.
   - `renderTemplate(key, vars)` renders subject (escaped, then tag-stripped) and body, wraps the body in the layout (step 6), and derives `text` by `stripHtml(html)` (`<br>`/`</p>` → `\n`, tags removed, entities decoded, collapse blank lines).
   - `validateTemplateBody(key, subject, body)` extracts all tokens from subject+body and returns the ones not present in that key's `TemplateVars` contract — used by [M37](./M37-comms-admin-ui.md) at save time, **never** at send time.
   **Done when:** `pnpm vitest run src/features/comms/render.test.ts` green with cases: hostile title `;lkj<img onerror=alert(1)>` renders escaped (`&lt;img`); a null var throws `TEMPLATE_VAR_MISSING`; unknown token `{{speaker.nickname}}` is reported by `validateTemplateBody` and never reaches the renderer; `tasks.outstanding_list` passes through as HTML; dot-path miss on a nested object throws rather than printing `[object Object]`.
3. **The send-time context builder** — `server/context.ts`. The log row carries **ids, not truth** (`contact_id`, `submission_id`, `session_id`, `task_id`, `template_key`, `ics_uid`); this is where truth is re-read.
   - `buildContext(row)` loads: `events` (name, slug, timezone, starts_at, location, logo_file_id), `contacts` (first/last/email, unsubscribed_at), and whichever of `submissions` / `sessions` (+room/track names) / `portal_tasks` the key needs. Everything through `db` (neon-http) — reads only.
   - **Send-time re-checks → `status='skipped'` (never a send):**
     | key | re-check | skip when |
     |---|---|---|
     | `submission_accepted` / `submission_declined` | re-read `submissions.status` | status no longer matches the key's decision (organizer undid it) |
     | `task_assigned` / `task_reminder` | re-read `task_assignments_v` for (task, contact, submission) | row absent (task deleted/deactivated, speaker un-accepted) or `completed = true` |
     | `schedule_assigned` / `schedule_changed` | re-read `sessions` | `starts_at IS NULL` or `status <> 'published'` → skip (the CANCEL path is [M35](./M35-ics-calendar-invites.md)'s, driven by its own outbox row) |
     | any reminder-class key (`task_reminder`) | `contacts.unsubscribed_at` | not null |
     | any key | `EMAIL_ALLOWLIST` non-empty and recipient not matching | always |
   - Variable sets per key (these are the `TemplateVars` contracts from [M02](./M02-shared-contracts.md); build exactly these, nothing more):
     - **all keys:** `event.name`, `event.start_date` (`formatInZone(event.starts_at, tz, 'PPP')` — always carries the zone label), `event.location`, `event.timezone`, `speaker.first_name`, `speaker.last_name`, `speaker.email`, `portal.magic_link`, `unsubscribe.url`
     - **+ submission_received / _accepted / _declined:** `submission.title`, `submission.code` (SESS-n)
     - **+ task_assigned / task_reminder:** `task.name`, `task.due_date` (event-tz, labeled), `tasks.outstanding_list` (pre-escaped `<ul><li>` built here from the contact's open `task_assignments_v` rows)
     - **+ schedule_assigned / schedule_changed:** `session.title`, `session.start_time_local`, `session.end_time_local`, `session.timezone`, `session.room`, `session.track`, plus the calendar links [M35](./M35-ics-calendar-invites.md) fills in (`calendar.google_url`, `calendar.outlook_url`, `calendar.download_url`)
   - **Token minting happens HERE, at send time** (binding resolution #12). `issuePortalToken` returns an **object** — interpolating it directly would put `[object Object]` in every judged email — so destructure it:
     ```ts
     const { raw } = await issuePortalToken(db, { contactId, eventId, purpose: 'magic_link', ttl: '30d' });
     vars.portal.magic_link = `${APP_BASE_URL}/portal/${event.slug}/verify?token=${raw}`;
     ```
     The first parameter is typed **`DbOrTx`** ([M02](./M02-shared-contracts.md) §11 / [M06b](./M06b-portal-auth.md)), which is what makes passing the neon-http `db` handle legal: the helper performs a single INSERT, so this must **not** open another `withTx` path (binding resolution #4). The **30 d** TTL is the documented dispatcher-minted row in M06b's TTL table (an ordinary domain-email link must outlive the 15-minute interactive login challenge).
   **Done when:** a PGlite test seeds a `queued` `submission_accepted` row, flips the submission back to `pending`, dispatches, and asserts the row ends `status='skipped'` with `error` naming the re-check — and **zero** Resend calls were attempted.
4. **The claim statement** — `server/dispatcher.ts`. ONE SQL statement so it runs on the neon-http driver (no Pool, no `withTx`). **`comm_status` is exactly `('queued','sent','failed','skipped')` — there is no `'sending'` value** (data-model §3.10, [M02](./M02-shared-contracts.md)'s `COMM_STATUSES`, [M03](./M03-db-schema-migrations.md) ★9). Writing one would fail the very first statement with a `22P02` invalid-enum-input error and take the entire judged email path down, so the row **stays `queued`** and the claim is expressed purely through `locked_until`:
   ```sql
   UPDATE communication_logs
      SET locked_until = now() + interval '3 minutes', attempts = attempts + 1
   WHERE id IN (
     SELECT id FROM communication_logs
     WHERE status = 'queued'
       AND next_attempt_at <= now()
       AND (locked_until IS NULL OR locked_until < now())   -- unclaimed, or a crashed claim that expired
     ORDER BY created_at
     LIMIT $budget
     FOR UPDATE SKIP LOCKED)
   RETURNING *;
   ```
   Crashed-dispatcher recovery falls out of the same predicate: a row whose `locked_until` has passed is simply claimable again. This needs **no schema change** — it is the deliberate choice over adding a `'sending'` enum value.
   `dispatchOutbox(budget = 50)` claims, then processes rows sequentially (bounded CPU), returning `JobStats` `{claimed, sent, skipped, failed, retried}` — `JobStats` is imported from **`@/shared/contracts`** (`contracts/jobs.ts`), never from `src/app/api/jobs/_lib.ts`: a feature importing from `app/` inverts the boundaries direction and is a CI failure.
   **Done when:** two `dispatchOutbox(50)` calls fired concurrently against 60 queued rows claim disjoint sets (PGlite/`sb-dev` test asserting no id appears twice) and every row ends in a terminal status (`sent`/`failed`/`skipped`) or back to an unlocked `queued` after both finish.
5. **Per-row pipeline.** For each claimed row: `buildContext` → (skip path: `UPDATE … SET status='skipped', error=$reason` and continue) → load the event's `email_templates` row for the key; **`enabled = false` → `status='skipped'`, reason `template disabled`** → **per-form override:** for `submission_received`, if the submission's `forms` row has a non-null `confirmation_subject` / `confirmation_body_html`, render **those** instead of the event template (same variable contract, same escaping, same validation) — this is what makes [M14](./M14-form-settings-notifications.md)'s "Customize" disclosure a real feature rather than a dead column → `renderTemplate` → persist `subject_rendered` + `body_rendered_html` before the provider call for ordinary keys → `EMAIL_MODE` gate → send → mark terminal. For `portal_login`, decrypt just-in-time, clear the ciphertext on every terminal path, and store a redacted body in production; only preview log mode with fallback diagnostics may retain the live rendered credential. **Production body storage redacts live credentials for *every* key, not just `portal_login`:** when `EMAIL_MODE=send` on production, the persisted `body_rendered_html`/`text` replace each dispatcher-minted token query param (`?token=…` on magic links and `/cal` URLs) with `?token=[redacted]` **before** the row is written — the sent email carries the real 30-day link; the comms log is an audit surface and must never double as a live-token viewer for anyone with admin read access. Preview log mode persists the full body (that is its diagnostic job).
   - **EMAIL_MODE matrix** (PLAN §2, authoritative — do not invent a third mode):
     | `EMAIL_MODE` | `EMAIL_ALLOWLIST` | behaviour |
     |---|---|---|
     | `log` (dev/preview default, and prod until the domain verifies) | ignored | render + persist `subject_rendered`/`body_rendered_html`, **no** Resend call, `status='sent'`, `provider_message_id='log-mode'`, `sent_at=now()` |
     | `send` (prod once verified) | unset | render + POST to Resend, `status='sent'` + real `provider_message_id` |
     | `send` | comma list set | recipient not matching any entry (exact email or `@domain` suffix) → `status='skipped'`, error `not in EMAIL_ALLOWLIST`; matching → send |
     - `EMAIL_FALLBACK_UI=1` does **not** change ordinary dispatch behavior — it is [M06b](./M06b-portal-auth.md)'s local/preview verify-page flag. Preview log mode may expose the `portal_login` credential for diagnostics; production clears its encrypted payload and stores a redacted body, so the comms log never becomes a production auth bypass.
   - **Resend call** — `server/resend.ts`, plain `fetch`, the **only** file in the repo allowed to name Resend (CI grep):
     `POST https://api.resend.com/emails`, headers `Authorization: Bearer ${RESEND_API_KEY}`, `Content-Type: application/json`, **`Idempotency-Key: ${row.idempotency_key}`** (verified by Fri check C1; if C1 failed, keep the header anyway — it is inert — and rely on the 3-min lock window, documented residual risk). Body `{from: EMAIL_FROM, to:[email], reply_to, subject, html, text, attachments?}`. Non-2xx → throw with status + body text.
   - **Terminal marking:** success → `status='sent', provider_message_id, sent_at=now(), error=NULL`. Failure → if `attempts >= 6` `status='failed'` else `status='queued', next_attempt_at = now() + least(power(2, attempts), 60) * interval '1 minute'`, `error` = truncated provider message. A `TEMPLATE_VAR_MISSING` throw is **terminal immediately** (`status='failed'`) — retrying a broken template 6 times is noise.
   **Done when:** `pnpm vitest run src/features/comms/dispatcher.test.ts` green for: log-mode send marks exactly one row `sent` and a second `dispatchOutbox` call sends nothing; a 500 from the (mocked) provider leaves `queued` with `attempts=1` and `next_attempt_at ≈ now+2min`; the 6th failure is terminal `failed`; a row left `queued` with `locked_until` in the past (a crashed claim) is re-claimed and completes once.
6. **The HTML shell + plain-text part** — `server/layout.ts`. One fixed inline-CSS shell: event logo (`${APP_BASE_URL}/f/${event.logo_file_id}` when present, else the event name as text), white card, footer with the event name and — for reminder-class keys only — the unsubscribe link. Max width 600px, no external CSS, no web fonts, no images other than the logo. `text` comes from `stripHtml` (step 2) and must be non-empty (spam hygiene).
   **Done when:** an eyeball check of the rendered `body_rendered_html` from a seeded `submission_accepted` row in log mode shows logo + greeting + a clickable portal link, and its `text` part contains the same URL as a bare line.
7. **`listLog`** — `server/queries.ts`: `SELECT` over `communication_logs` joined to `contacts` (email, first/last name), ordered `created_at DESC`, filterable by `contactId` / `templateKey` / `status`, default `limit 200`, mapped to the frozen `CommLogRow` contract:
   **`CommLogRow` is imported from `@/shared/contracts` ([M02](./M02-shared-contracts.md) §4), not declared here** — contracts froze M34's field names (`recipientEmail`, `recipientName`) precisely so [M27](./M27-speakers-admin.md)'s fixture and [M37](./M37-comms-admin-ui.md)'s table cannot drift from this query. `body_rendered_html` is deliberately **not** on the list row (it is large and contains a live magic link); it lives on the sibling **`CommLogDetail = CommLogRow & { bodyRenderedHtml, idempotencyKey, attempts }`**, which only [M37](./M37-comms-admin-ui.md)'s detail fetch loads and [M40](./M40-public-api.md) never exposes. Event-scoped first arg, always.
   **Done when:** `listLog(seededEventId)` returns the seeded rows and `listLog(otherEventId)` returns `[]` (event-scoping test).
8. **Wire the job route + the seed module.** Swap [M08](./M08-jobs-worker.md)'s `stubOutbox` for `dispatchOutbox` (`() => dispatchOutbox(50)`). Write `scripts/seed/comms.ts` per the "Soft deps" fixture list, exported as `seedComms(tx, ctx)` for the architect's orchestrator (insertion order: last, after sessions/tasks).
   **Done when:** on the deployed preview, `curl -X POST -H 'x-cron-secret: …' $APP_BASE_URL/api/jobs/outbox` returns `{"stats":{"claimed":6,"sent":5,"skipped":1,…}}` on the first call and `{"claimed":0}` on the second.
9. **File map check** (so no other WS-F module collides): `index.ts` (barrel, yours), `server/dispatcher.ts` (claim + per-row pipeline), `server/context.ts` (re-reads + vars + token minting), `server/render.ts` (mustache subset + `stripHtml` + `validateTemplateBody`), `server/layout.ts` (HTML shell), `server/templates.ts` (defaults + `seedDefaultTemplates`), `server/resend.ts` (the only Resend caller), `server/queries.ts` (`listLog`). [M35](./M35-ics-calendar-invites.md) adds `ics.ts` + `server/invites.ts`; [M36](./M36-reminder-scan.md) adds `server/reminders.ts` + `server/triggers.ts`; [M37](./M37-comms-admin-ui.md) adds `components/`, `hooks/`, `index.client.ts`, `server/admin-mutations.ts`. Nothing else in `features/comms` is created by anyone.
   **Done when:** `ls src/features/comms/server` matches the list above exactly.
10. **Sat-night thin-slice participation.** After [M18](./M18-submission-mutations-notify.md)'s `createSubmission` lands, re-run the thin slice: submit through the real endpoint → confirm a `submission_received` row appears `queued` → cron tick → `sent` in log mode with a rendered body. Paste the log row into the checkpoint notes.
   **Done when:** a real (non-seeded) submission produces exactly one `sent` log row with `idempotency_key = {eventId}:received:{submissionId}`.

## Acceptance criteria
**Catalog AC (verbatim):** seeded queued rows send (log mode) exactly once across repeated dispatches; hostile-titled submission renders escaped; unknown `{{var}}` rejected at template save; crash-simulated claim re-sends after lock expiry without duplication; a decision email's magic link is minted at send time (token created_at ≈ sent_at, not enqueue time).

Verification:
- `pnpm vitest run src/features/comms/render.test.ts src/features/comms/dispatcher.test.ts`
- `psql $SB_DEV -c "select status, count(*) from communication_logs group by 1"` before/after two dispatch calls — `sent` count unchanged on the second.
- Escaping: `psql -c "select body_rendered_html from communication_logs where subject_rendered like '%;lkj%'"` contains `&lt;img` and never `<img onerror`.
- Token freshness: `psql -c "select extract(epoch from (pt.created_at - cl.sent_at)) from portal_tokens pt join communication_logs cl on cl.contact_id = pt.contact_id order by pt.created_at desc limit 1"` → |Δ| < 5 s, and `pt.created_at - cl.created_at` is minutes/hours.
- Crash sim: `psql -c "update communication_logs set locked_until = now() - interval '1 min' where id = '…' and status='queued'"` then dispatch → row ends `sent`, one row total. (No `status='sending'` — that value does not exist in `comm_status`.)
- Playwright: covered indirectly by `abstracts-decide.spec` ([M10](./M10-e2e-release.md)) asserting exactly one comms-log row per notified submission.

## Guardrails
- **Insert-first idempotency firewall.** `communication_logs.idempotency_key` is UNIQUE; every producer inserts via [M04](./M04-shared-libs.md)'s `enqueueEmail` with `ON CONFLICT DO NOTHING`. The dispatcher never inserts log rows and never invents keys. Key recipes are frozen in contracts (PLAN §3) — `{eventId}:received:{submissionId}`, `{eventId}:decision:{submissionId}:{notify_revision}`, `{eventId}:task_assigned:{taskId}:{contactId}:{submissionId|-}`, `{eventId}:task_reminder:{taskId}:{contactId}:{submissionId|-}:{offsetDays}`, `{eventId}:sched:{sessionId}:{contactId}:{schedule_revision}`.
- **One Resend chokepoint** — `server/resend.ts` only. CI greps for `resend` outside it. No `resend` npm SDK; plain `fetch`.
- **Payload holds ids, not truth** — never cache rendered values at enqueue time, never trust a status you did not re-read in `buildContext`.
- **Tokens minted at send time, never at enqueue time** (resolution #12). If you find `issuePortalToken` called from a domain feature, that is a review-blocker, not a shortcut.
- **Organizer HTML is sanitized on save**, not on render (resolution #2) — `validateTemplateBody` does not sanitize; [M37](./M37-comms-admin-ui.md)'s save path calls `sanitize()`. The renderer still escapes every interpolated value: two independent defences.
- **Null var = loud failure.** "Hi {{first_name}}" or "Hi undefined" in a judge's inbox is a P0. The test for this is non-negotiable.
- **Date formatting only via `time.ts`** — `date-fns`/`date-fns-tz` imports outside `shared/lib/time.ts` fail CI. Email bodies show event-tz times **with the zone label**; ICS is UTC and bypasses this entirely ([M35](./M35-ics-calendar-invites.md)).
- **`withTx` stays at 8 audited functions** (resolution #4) — the dispatcher is single-statement claim + single-statement marks on neon-http. Do not add a transaction here.
- Edge cases from the analyses: contact with `unsubscribed_at` → reminder-class skipped, decision/schedule mail still sends; template `enabled=false` → skipped not failed; event with no logo → text-only header (no broken image); a contact deleted between enqueue and send → the composite FK cascades the log row away, so a claimed row whose contact read returns nothing must mark `skipped`, not crash the batch; **one bad row must never abort the batch** — wrap each row's processing in its own try/catch.
- Empty state: `listLog` on a brand-new event returns `[]` and [M37](./M37-comms-admin-ui.md)/[M27](./M27-speakers-admin.md) render an `<EmptyState>` — no "0 results" crash.

## If blocked
- Blocked on [M03](./M03-db-schema-migrations.md)'s ★ columns (`attempts`/`locked_until`/`body_rendered_html`): build steps 1–2 (barrel, `seedDefaultTemplates`, renderer + its full test table) — they touch no new columns and unblock [M11](./M11-events-feature.md) and [M37](./M37-comms-admin-ui.md).
- Blocked on Resend credentials/domain: everything is buildable and demoable in `EMAIL_MODE=log`; do not wait.
- Blocked on `issuePortalToken`: keep token-bearing rows in `EMAIL_MODE=log` (or point the template var at a deterministic **seed-planted `portal_tokens` fixture row**, the same pattern [M35](./M35-ics-calendar-invites.md) uses for `/cal`) and keep going — **never invent an unhashed token** (the dependency note above is binding). The swap is one function.
- Ahead of schedule: start [M35](./M35-ics-calendar-invites.md) step 1 (pure ICS builder + golden fixtures — it needs only [M02](./M02-shared-contracts.md)), or run the Sat WS-F checklist items ([M35](./M35-ics-calendar-invites.md) canned-invite curl, [M39](./M39-airtable-export.md) base provisioning + hand-run `performUpsert`), or extend `scripts/seed/comms.ts` with a `failed` row and a `skipped` row so [M37](./M37-comms-admin-ui.md)'s log filters have data on Tuesday.
