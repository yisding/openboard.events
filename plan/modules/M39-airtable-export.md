# M39 — Airtable export

| | |
|---|---|
| **Status** | NOT STARTED |
| **Workstream / executing agent** | WS-F (Comms + Dashboard + Airtable + API) — feature folder `airtable`. |
| **Scheduled** | **Sat PM: the 30-minute provisioning checklist (step 1) — base + 5 tables + fields + one hand-run `performUpsert` verified.** **Tuesday: the sync itself**, whose first 15 minutes re-verify the merge behaviour before any sync code is trusted. |
| **Size** | M (≈half-day) |
| **Paths owned** | `src/features/airtable/index.ts`, `src/features/airtable/server/client.ts`, `src/features/airtable/server/sync.ts`, `src/features/airtable/server/sources.ts`, `src/features/airtable/components/**`, `src/features/airtable/sync.test.ts`, `src/app/(admin)/events/[eventId]/settings/integrations/page.tsx`, `src/app/api/internal/airtable/**`, `docs/airtable-base.md` |

## Objective
A one-way, idempotent, rate-limited push mirrors five tables (Speakers, Submissions, Sessions, Task Status, Comms Log) from Postgres views into a provisioned Airtable base, keyed on a `PG ID` merge field. It runs inside `sb-web` through the job route (manual admin button + optional `%10` trigger from `sb-jobs`), resumes from a watermark taken from each view's `greatest(updated_at)` column, skips unchanged rows by content hash, and never blocks a user request. The admin Settings → Integrations page shows last run, per-table stats, and errors.

## Dependencies
- **Hard (blocks start):**
  - [M03](./M03-db-schema-migrations.md) — `airtable_sync_state` (`UNIQUE(table_name, record_pk)`), `airtable_sync_runs`, and **every exported view carrying `greatest(a.updated_at, b.updated_at, …) AS updated_at`** (the ★ delta in PLAN §3 — without it, a speaker bio edit that only touches a joined table is silently skipped). Verify the column exists on `accepted_speakers_v`-backed sources before writing sync code.
  - [M08](./M08-jobs-worker.md) — `POST /api/jobs/airtable` (%10) to wire into.
  - **Step 1's provisioning must be complete** (Saturday) with `AIRTABLE_API_KEY` + `AIRTABLE_BASE_ID` on the preview/production web environments only, `AIRTABLE_CRON=0` by default, and the hand-run `performUpsert` verified. The jobs worker receives none of these values.
- **Soft (start against stub/fixture):**
  - Source data: [M09](./M09-seed-demo-script.md)'s seed is sufficient for every table (12 speakers, ~25 submissions, ~15 sessions, 3 tasks, pre-populated comms log). No dependency on any other workstream's UI.
  - [M34](./M34-comms-outbox-dispatcher.md)'s `listLog` powers the Comms Log table; until it lands, read `communication_logs` directly inside `sources.ts` and swap to `listLog` when convenient (same feature-barrel rule: `airtable` reads other features only through their exported contracts).
  - [M11](./M11-events-feature.md)'s settings hub tabs: this module ships its **own route file** under `settings/integrations/` (declared cross-folder pattern, same as [M40](./M40-public-api.md)'s API-keys page) so there is no merge contention on the hub page.

## Provides (interfaces others consume)
```ts
// src/features/airtable/index.ts
import type { JobStats } from '@/shared/contracts';   // contracts/jobs.ts — NEVER from src/app/api/jobs/_lib.ts
export async function runAirtableSync(budget: number): Promise<JobStats>;   // wired to POST /api/jobs/airtable (M08)
export async function getSyncStatus(eventId: EventId): Promise<{
  lastRunAt: string | null; status: 'running'|'success'|'failed'|null;
  stats: Record<AirtableTable, { created: number; updated: number; skipped: number; errors: number }>;
  error: string | null; watermarks: Record<AirtableTable, string | null>;
}>;                                                                          // PROPOSED, consumed by the Integrations page
export type AirtableTable = 'Speakers' | 'Submissions' | 'Sessions' | 'Task Status' | 'Comms Log';
```
- `POST /api/internal/airtable/[eventId]/sync` — admin-only manual trigger (inserts the run row, then `ctx.waitUntil(runAirtableSync(300))`), `GET /api/internal/airtable/[eventId]/status`.
- `docs/airtable-base.md` — the base recipe (table names, field names/types, the `PG ID` field) so the base is reproducible by a judge or after a wipe. Linked from the README by [M10](./M10-e2e-release.md).

## Step-by-step implementation

1. **★ SATURDAY, SCHEDULED — provisioning + the hand-run verification (30 min, no app code).**
   - Create the base and 5 tables. Fields (all single-line text unless noted; **every table gets `PG ID` (single line text) as the merge field**):
     | Table | Fields |
     |---|---|
     | `Speakers` | Name, Email, Company, Job Title, Bio (long text, plaintext-stripped), Headshot URL, Confirmation, Open Tasks (number), PG ID |
     | `Submissions` | Code, Title, Status, Kind, Track, Tags, Format, Rating (number), Submitter Email, Speakers, Submitted At (date), Notified At (date), PG ID |
     | `Sessions` | Title, Day, Starts (date), Ends (date), Room, Track, Speakers, PG ID |
     | `Task Status` | Task, Speaker, Submission Code, Due (date), Status, Completed At (date), PG ID |
     | `Comms Log` | Recipient, Template, Status, Sent At (date), PG ID |
   - Store `AIRTABLE_API_KEY` (PAT, scope `data.records:write` + `schema.bases:read`) and `AIRTABLE_BASE_ID` in **both** env sets (`.dev.vars` and `wrangler secret put`), and write the base/table ids into `DECISIONS.md`.
   - **Hand-run one upsert** (this is the platform doc's NEEDS-VERIFY item, and it is the gate for the whole module):
     ```bash
     curl -sS -X PATCH "https://api.airtable.com/v0/$AIRTABLE_BASE_ID/Speakers" \
       -H "Authorization: Bearer $AIRTABLE_API_KEY" -H 'Content-Type: application/json' \
       -d '{"performUpsert":{"fieldsToMergeOn":["PG ID"]},
            "records":[{"fields":{"PG ID":"test-1","Name":"Ada","Email":"ada@example.com"}}]}'
     ```
     Run it **twice**. **Done when:** the second run updates the same record (`"updatedRecords"` non-empty, `"createdRecords"` empty) and the table shows exactly one Ada row; paste both responses into `DECISIONS.md`. **If the merge does not behave:** adopt the pre-decided fallback (`airtable_sync_state` as a classic record-map with create-vs-update branching, ~40 extra lines) and note it — the state table exists either way.
2. **★ TUESDAY, FIRST 15 MINUTES — re-verify.** Re-run the exact curl from step 1 against the provisioned base before writing any sync code (PLAN §7). Bases and PATs drift; discovering this after the sync is written costs an hour.
   **Done when:** the two-run result is reproduced and timestamped in `DECISIONS.md`.
3. **Contract-first slice.** Create `src/features/airtable/index.ts` with `runAirtableSync` (throwing) and `getSyncStatus` (reading `airtable_sync_runs` — real immediately, so the Integrations page can be built in parallel). Wire [M08](./M08-jobs-worker.md)'s `stubAirtable` → `runAirtableSync` behind `getEnv().AIRTABLE_CRON === '1'` (flag-gated per PLAN; the manual button always works).
   **Done when:** `curl -XPOST -H 'x-cron-secret: …' …/api/jobs/airtable` returns `{"ok":true}` and does nothing when the flag is off.
4. **The client** — `server/client.ts`, plain `fetch`, ~80 lines. **The `airtable` npm SDK is banned** (old, callback-based, heavy).
   - `upsertBatch(table, records)`: `PATCH https://api.airtable.com/v0/{baseId}/{encodeURIComponent(table)}` with `{performUpsert:{fieldsToMergeOn:['PG ID']}, records:[{fields:{…}}]}`, **max 10 records per request**.
   - Throttle: `await sleep(275)` between requests (≤4 rps against Airtable's 5 rps limit). On `429`: sleep 30 s, retry once, then abort the table and record the error.
   - Every payload is zod-parsed through a per-table `airtableRowSchema` **before** the request (R2 boundary #5) — this is what stops `undefined`/`null` leaking into the API and producing 422s mid-batch.
   **Done when:** a unit test with a mocked fetch asserts batching at 10, the 275 ms gap, the exact `performUpsert` body shape, and that a row failing its zod schema is dropped-and-counted rather than aborting the batch.
5. **Sources + watermark** — `server/sources.ts`. One function per table returning `{ pk, updatedAt, fields }[]`, each reading **views only** (status filtering comes free: `Speakers` from `contacts ∩ accepted_speakers_v` + `speaker_outstanding_v.open_count`; `Sessions` from `published_sessions_v` + speakers; `Task Status` from `task_assignments_v`; `Submissions` from `submissions` non-draft + `submission_ratings_v`; `Comms Log` from `communication_logs`).
   - **Watermark query shape:** `… WHERE v.updated_at > $watermark ORDER BY v.updated_at ASC LIMIT $batch` where `v.updated_at` is the view's `greatest(...)` aggregate. This is the ★ requirement: a speaker bio edit changes `contacts.updated_at`, and the Sessions row that joins that speaker must therefore also move — the aggregate makes that true without per-table hacks.
   - **Watermark storage** (PROPOSED, zero schema change): a sentinel row per table in `airtable_sync_state` — `record_pk = '__watermark__'`, `airtable_record_id = '-'`, `content_hash = <ISO timestamp>` — upserted **after each batch commits to Airtable**, so a crashed run resumes exactly where it stopped. Mirror the same values into the finishing run's `airtable_sync_runs.stats.watermarks` for the admin UI.
   - `record_pk`: the entity uuid, except `Task Status` = `{taskId}:{contactId}:{submissionId|-}` (assignments are lazy view rows with no PK — same rule as the idempotency keys).
   **Done when:** `getSources()` for a fresh event with a NULL watermark returns every row; after a full sync the same call returns 0; touching one contact's bio makes both its Speakers row **and** its Sessions rows reappear.
6. **The sync loop** — `server/sync.ts`. `runAirtableSync(budget = 300)`:
   1. **Single-flight guard:** refuse (return `{skipped: 1}`) if an `airtable_sync_runs` row with `status='running'` and `started_at > now() - interval '10 minutes'` exists. Insert a `running` row otherwise.
   2. For each table in a fixed order, until the 300-record budget is spent: read the next batch (100 rows) past the watermark → build fields → `content_hash = sha256(canonical JSON of fields)` (Web Crypto, stable key order) → diff against `airtable_sync_state`: unknown pk → send; known + hash differs → send; hash equal → **skip** (counted, logged) → `upsertBatch` in chunks of 10 → upsert `airtable_sync_state` rows with the returned `airtable_record_id` + new hash → advance the watermark sentinel.
   3. Finish the run row: `status='success'` (even when budget-truncated — record `stats.truncated = true`) or `'failed'` with the error. Per-table stats `{created, updated, skipped, errors}`.
   **Done when:** running the sync twice back to back yields `created > 0, skipped = 0` then `created = 0, updated = 0, skipped = N` — the runbook AC below.
7. **Admin Integrations page.** `settings/integrations/page.tsx`: a **Sync to Airtable** button (`<ConfirmDialog>` → POST → toast), a status chip ("Last sync 12:04 · 38 created, 3 updated, 0 errors"), a per-table stats table, the last error, and one honest sentence: *"One-way mirror. Airtable-side edits are overwritten on the next sync; deletions are not propagated — withdrawn rows export with their status."* Poll `getSyncStatus` every 5 s **while a run is running**, otherwise on focus.
   **Done when:** clicking the button on the deployed preview populates the base and the chip updates without a page reload.
8. **Runbook + docs.** Write `docs/airtable-base.md` (the table/field recipe from step 1 + the two curl commands + the double-run runbook). Add the 60-second Airtable line to `docs/demo-script.md`.
   **Done when:** a teammate can rebuild the base from the doc alone.

## Acceptance criteria
**Catalog AC (verbatim):** manual runbook — run sync twice against the provisioned base: zero duplicates, hash-skips logged; a failed run resumes from watermark; an update that only touches a joined table (e.g. speaker bio on a session row) syncs on the next run; never blocks a user request.

Verification:
- `pnpm vitest run src/features/airtable/sync.test.ts` (batching, throttle, hash-skip, watermark advance, single-flight guard — all with a mocked fetch; **no test hits Airtable**, per the "explicitly NO tests" budget: Airtable correctness is a manual runbook).
- Runbook: click Sync twice → Airtable row counts identical after both; `psql -c "select stats from airtable_sync_runs order by started_at desc limit 2"` shows `created>0/skipped=0` then `created=0/skipped=N`.
- Joined-table freshness: edit a seeded speaker's bio in the portal → Sync → that speaker's `Sessions` rows show the new speaker data (proves the `greatest(updated_at)` watermark).
- Resume: kill the run mid-flight (deploy a new version / abort the request), re-run → it continues from the sentinel watermark, no duplicates.
- Non-blocking: the manual trigger returns `202` in < 200 ms (`curl -w '%{time_total}'`) with the work in `ctx.waitUntil`.

## Guardrails
- **Views only, watermark on the view's `greatest(...) AS updated_at`.** Reading base tables directly reintroduces the silent-skip bug this ★ delta exists to kill.
- **`performUpsert` with `fieldsToMergeOn: ['PG ID']`** — the merge field must be present and non-empty on **every** record or Airtable creates duplicates. Assert non-empty `PG ID` in the zod row schema.
- **10 records per request, ≥275 ms between requests, 300-record budget per run.** Exceeding 5 rps gets the token throttled mid-demo; exceeding the CPU budget kills the job. The next tick resumes.
- **Never in a user request.** The button inserts a run row and hands off to `ctx.waitUntil`; a failing Airtable token must never surface as a broken admin page (risk table: "zero user-facing impact").
- **One-way, append/update-only.** No reads from Airtable into app logic, no delete propagation. Withdrawn submissions export with `Status = Withdrawn` — never vanish misleadingly.
- **Single-flight** — the cron and a button click landing together must not double-write; the 10-minute `running` guard is the whole mechanism.
- **Secrets discipline:** `AIRTABLE_*` are read via `getEnv()` only (no `process.env` outside `env.ts`); the PAT never appears in logs or in the status UI.
- Edge cases: a speaker with no headshot → `Headshot URL` empty string, not `"null"`; long bios → strip tags then truncate to Airtable's long-text limit; a submission with no track → `Track` empty (Uncategorized), not `"undefined"`; hostile titles (`;lkj`, RTL, 255 chars) go through as text (Airtable does not interpret them, but the zod schema must not choke); the empty second event syncs zero rows and still finishes `success`; renaming a table in Airtable breaks the sync loudly (error recorded on the run row) rather than silently creating a new one.
- **Cut-line #9:** if Tuesday is tight, drop the `%10` cron (manual button only); if it is *very* tight, drop the whole module — it is a SHOULD bonus, and everything else in WS-F outranks it.

## If blocked
- Blocked on the Airtable account/PAT: do step 1's schema design on paper in `docs/airtable-base.md`, then move to [M40](./M40-public-api.md) or [M37](./M37-comms-admin-ui.md) (same Tuesday lane) and return when access exists.
- Blocked on `performUpsert` (verification failed): adopt the record-map fallback immediately — `airtable_sync_state.airtable_record_id` already stores what create-vs-update branching needs; the only delta is a `POST` for unknown pks and a `PATCH /{recordId}` for known ones.
- Blocked on missing view `updated_at` aggregates: escalate to the architect (additive view replacement is legal); meanwhile sync with `watermark = NULL` (full push every run) — correct, just wasteful, and enough to demo.
- Ahead of schedule: finish [M40](./M40-public-api.md)'s keyed endpoints, help close [M37](./M37-comms-admin-ui.md), or add the Airtable screenshot to the submission evidence in `docs/spend/`.
