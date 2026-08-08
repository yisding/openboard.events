# M36 — Triggers + reminder/assignment scan

| | |
|---|---|
| **Status** | NOT STARTED |
| **Workstream / executing agent** | WS-F (Comms + Dashboard + Airtable + API) — feature folder `comms`. |
| **Scheduled** | **Sun** (with [M35](./M35-ics-calendar-invites.md)). Live on cron by Mon; CP3 verifies the seeded overdue task fires **exactly one** email. |
| **Size** | M (≈half-day) |
| **Paths owned** | `src/features/comms/server/reminders.ts`, `src/features/comms/server/triggers.ts`, `src/features/comms/reminders.test.ts`. Appends **only** its named export lines to `src/features/comms/index.ts` (owned by [M34](./M34-comms-outbox-dispatcher.md)). |

## Objective
One idempotent 15-minute scan replaces all event-driven cross-feature coupling for onboarding mail. Pass 1 finds `task_assignments_v` rows that have never been announced and enqueues `task_assigned` — so a speaker accepted *after* a task was created is covered for free, with zero accept-path knowledge of tasks. Pass 2 is the **burst-safe** reminder ladder: per open assignment it fires only the **latest eligible rung** and permanently retires older elapsed rungs as `status='skipped'` rows, so a seeded task that is already overdue sends exactly ONE email on the first tick rather than three.

## Dependencies
- **Hard (blocks start):**
  - [M34](./M34-comms-outbox-dispatcher.md) — the dispatcher drains what this enqueues; `seedDefaultTemplates` created the `reminder_rules` rows (−7, −1, +1) and the `task_assigned`/`task_reminder` templates.
  - [M03](./M03-db-schema-migrations.md) — `task_assignments_v` **with the resolution-#14 fan-out rule baked into the view SQL**, `reminder_rules`, `portal_tasks` (incl. `created_at`, `is_active`, `due_at`), `submissions.decided_at`, `communication_logs.idempotency_key UNIQUE` + `status='skipped'` — migrated on sb-dev and sb-test.
  - [M04](./M04-shared-libs.md) — `enqueueEmail(tx, {templateKey, contactId, idempotencyKey, refs})`.
  - [M08](./M08-jobs-worker.md) — `POST /api/jobs/reminders` (%15) to wire into.
- **Soft (start against stub/fixture):**
  - Real tasks and completions arrive with [M23](./M23-tasks-admin.md)/[M25](./M25-task-runtime.md) (Mon). Build entirely against [M09](./M09-seed-demo-script.md)'s **3 seeded tasks (one deliberately overdue)** and the seeded accepted submissions — they exist Sat AM and are the exact fixture the CP3 check uses. No swap step needed; real rows flow through the same view.
  - `ctx.waitUntil` nudge consumers. The call site is now written into each consumer's own work order — [M16](./M16-submit-pipeline.md) Step 4 (step 9 of the submit handler), [M18](./M18-submission-mutations-notify.md) step 3.9 and step 6, [M28](./M28-sessions-crud.md) Step 3's `notifySchedule` — so it is scheduled work, not a channel message nobody's work order tells them to read. **If any of the three has not landed the one-liner by Sunday evening, M36 opens the three one-line PRs itself** (Step 6) against `src/features/forms/server/submit.ts`, `src/app/api/internal/submissions/[eventId]/notify/route.ts` and `src/features/agenda/server/mutations.ts`. The cron is the guaranteed sweeper; the nudge is latency polish that turns CP2's "exactly one logged email per submission" demo from cron-latency into ~1 s.

## Provides (interfaces others consume)
```ts
// src/features/comms/index.ts (appended)
import type { JobStats } from '@/shared/contracts';   // contracts/jobs.ts — NEVER from src/app/api/jobs/_lib.ts
export async function scanReminders(): Promise<JobStats>;   // BOTH passes; wired to POST /api/jobs/reminders (M08)
export function nudgeOutbox(waitUntil: (p: Promise<unknown>) => void): void;  // PROPOSED — best-effort ~1s email latency
export async function sendReminderNow(eventId: EventId, taskId: TaskId, contactId: ContactId,
                                      submissionId: SubmissionId | null): Promise<{ enqueued: boolean }>; // PROPOSED, consumed by M37
```
- `scanReminders` → [M08](./M08-jobs-worker.md) (`stubReminders` swap).
- `nudgeOutbox(ctx.waitUntil)` → called by any feature immediately after a user-facing `enqueueEmail` commit ([M16](./M16-submit-pipeline.md) submit confirmation, [M18](./M18-submission-mutations-notify.md) notify, [M28](./M28-sessions-crud.md) schedule). It runs `dispatchOutbox(10)` in the background; failures are swallowed and logged.
- `sendReminderNow` → [M37](./M37-comms-admin-ui.md)'s per-speaker "send reminder now" button.
- `JobStats` keys this module returns: `{assignedEnqueued, remindersEnqueued, rungsRetired, scanned}`.

## Step-by-step implementation

1. **Contract-first slice.** Append the three signatures to the barrel with `scanReminders` returning `{scanned:0}` and `nudgeOutbox` already real (it is 5 lines: `waitUntil(dispatchOutbox(10).catch(e => log.warn(…)))`). Tell WS-B/C/E in the channel that `nudgeOutbox` is importable now.
   **Done when:** `pnpm tsc --noEmit` green and [M08](./M08-jobs-worker.md)'s `/api/jobs/reminders` route imports `scanReminders` instead of the stub.
2. **Pass 1 — `task_assigned`, insert-or-ignore.** In `server/reminders.ts`, select the candidates in one statement:
   ```sql
   SELECT a.event_id, a.task_id, a.contact_id, a.submission_id
   FROM task_assignments_v a
   WHERE NOT a.completed
     AND NOT EXISTS (
       SELECT 1 FROM communication_logs cl
       WHERE cl.idempotency_key = a.event_id || ':task_assigned:' || a.task_id || ':' || a.contact_id
                                  || ':' || coalesce(a.submission_id::text, '-'))
   LIMIT $budget;   -- budget 500
   ```
   For each row call `enqueueEmail(db, {templateKey:'task_assigned', contactId, idempotencyKey: keys.taskAssigned(...), refs:{taskId, submissionId}})` — the recipe comes from [M02](./M02-shared-contracts.md)'s frozen key builders, never string-concatenated at the call site.
   **Done when:** PGlite test — a task created *before* a submission is accepted produces zero rows; after accepting the submission, the next scan produces exactly one `task_assigned` row; running the scan again produces none.
3. **Pass 2 — the burst-safe ladder. Compute the rung sets in one SELECT.** This is the module's core; write the SQL before any TypeScript.
   ```sql
   WITH rules AS (SELECT event_id, offset_days FROM reminder_rules WHERE enabled),
   assign AS (
     SELECT a.event_id, a.task_id, a.contact_id, a.submission_id, a.due_at,
            greatest(t.created_at, coalesce(s.decided_at, c.first_accepted_at)) AS materialized_at
     FROM task_assignments_v a
     JOIN portal_tasks t ON t.id = a.task_id
     LEFT JOIN submissions s ON s.id = a.submission_id AND s.status = 'accepted'
     LEFT JOIN LATERAL (
       SELECT min(s2.decided_at) AS first_accepted_at
       FROM submissions s2 JOIN submission_participants sp ON sp.submission_id = s2.id
       WHERE sp.contact_id = a.contact_id AND s2.event_id = a.event_id AND s2.status = 'accepted') c ON true
     WHERE NOT a.completed AND a.due_at IS NOT NULL),
   rungs AS (
     SELECT assign.*, r.offset_days, assign.due_at + make_interval(days => r.offset_days) AS rung_at
     FROM assign JOIN rules r ON r.event_id = assign.event_id),
   elapsed AS (SELECT * FROM rungs WHERE rung_at <= now()),
   fire AS (
     SELECT DISTINCT ON (event_id, task_id, contact_id, submission_id) *
     FROM elapsed WHERE rung_at >= materialized_at
     ORDER BY event_id, task_id, contact_id, submission_id, rung_at DESC)
   SELECT e.*, (f.offset_days IS NOT NULL) AS is_fire
   FROM elapsed e
   LEFT JOIN fire f USING (event_id, task_id, contact_id, submission_id, offset_days)
   LIMIT $budget;   -- budget 1000
   ```
   The four-line rule this encodes, stated plainly:
   1. **elapsed** = rungs whose instant has passed. Future rungs are ignored entirely — *nothing is pre-scheduled, so nothing can go stale*.
   2. **materialized_at** = `greatest(task.created_at, the target's accepted_at)` — the instant the assignment could first have existed.
   3. If any elapsed rung is `>= materialized_at`, the **latest** one fires (queued). Every other elapsed rung — including all pre-materialization ones — is **retired** as `status='skipped'`.
   4. If no elapsed rung is `>= materialized_at` (a task created due-tomorrow: its −7d rung is elapsed but predates the task), **nothing fires** and every elapsed rung is retired.
   **Done when:** running the SELECT against the seeded overdue task returns exactly one `is_fire = true` row and the rest `false`.
4. **Write the two outcomes.** For `is_fire` rows → `enqueueEmail(db, {templateKey:'task_reminder', …, idempotencyKey: keys.taskReminder(eventId, taskId, contactId, submissionId, offsetDays)})`. For the rest → `retireRung(row)`: a comms-local insert
   ```sql
   INSERT INTO communication_logs (event_id, contact_id, template_key, idempotency_key, status, error, task_id, submission_id)
   VALUES ($e,$c,'task_reminder',$key,'skipped','superseded rung (offset ' || $off || ')', $t, $s)
   ON CONFLICT (idempotency_key) DO NOTHING;
   ```
   `retireRung` lives in `server/reminders.ts` and is the **only** non-`enqueueEmail` writer of `communication_logs` outside the dispatcher. **No CI change is needed** — [M01](./M01-scaffold-ci-deploy.md) §10's grep #8 already allowlists `src/features/comms/server/**` alongside `src/shared/server/enqueue-email.ts`, and `scripts/check-invariants.sh` is architect-owned (any change is an architect-labeled one-line PR, never a direct edit from this lane).
   **Done when:** the PGlite AC test below passes.
5. **`sendReminderNow`.** Enqueue a `task_reminder` for one (task, contact, submission) with a **distinct** key so the per-rung dedupe cannot swallow a deliberate manual nudge. **Use `idem.taskReminderManual(eventId, taskId, contactId, submissionId, minuteBucket)` from `@/shared/contracts`** — the recipe is already in [M02](./M02-shared-contracts.md) §8 (frozen at CP1, so there is no additive-PR race on Sunday) and expands to `{eventId}:task_reminder:{taskId}:{contactId}:{submissionId|-}:manual:{minuteBucket}` with `minuteBucket = Math.floor(Date.now()/60000)`. The `:manual:` segment is what keeps a deliberate nudge from colliding with a scanned rung; the minute bucket makes double-clicks idempotent. **No ad-hoc string concatenation** — this module's own guardrail says so. Returns `{enqueued:false}` if the assignment is completed or absent.
   **Done when:** clicking twice within a minute produces one row; clicking again the next minute produces a second.
6. **Wire the job + the nudge.** `/api/jobs/reminders` → `scanReminders()`. Confirm on the deployed preview that the %15 tick logs `{"job":"reminders","stats":{…}}`. Add the one-line `nudgeOutbox` usage comment to the barrel.
   **Then verify the three nudge call sites exist, and open the PRs yourself if they do not** (`ctx.waitUntil` is named in PLAN §2, so an unwired nudge is a missing feature, not a nice-to-have):
   | consumer | file | line to add |
   |---|---|---|
   | [M16](./M16-submit-pipeline.md) submit | `src/features/forms/server/submit.ts` | after `createSubmission` returns |
   | [M18](./M18-submission-mutations-notify.md) notify | `src/app/api/internal/submissions/[eventId]/notify/route.ts` | after `notifyQueues` returns |
   | [M28](./M28-sessions-crud.md) schedule | `src/features/agenda/server/mutations.ts` (`notifySchedule`) | after the enqueue statement |
   Each is literally `nudgeOutbox(ctx.waitUntil)` from `@/features/comms`, best-effort, failures swallowed. Sunday evening: if a line is missing, open the one-line PR against that file and tag its owner — do **not** leave it to a channel message.
   **Done when:** `wrangler tail sb-jobs` shows a `reminders` line at :00/:15/:30/:45, the returned stats are all zero on the second consecutive tick, and `grep -rn "nudgeOutbox(" src | wc -l` is ≥ 3 (plus the definition).
7. **CP3 evidence.** Reset the seed, let one cron tick run, and screenshot the comms log filtered to the overdue seeded task: one `queued`/`sent` row + the retired `skipped` rows, each with its offset in the error text.
   **Done when:** the screenshot is in the CP3 notes and the row counts match the AC.

## Acceptance criteria
**Catalog AC (verbatim):** PGlite: task due yesterday with the full −7/−1/+1 ladder enabled → **exactly one queued row + two skipped rows on first scan**; scan twice → no new rows; complete the task then scan → zero; **a submission accepted AFTER task creation gets its task_assigned email on the next scan**; per-rung key means no re-nag ever.

Verification:
- `pnpm vitest run src/features/comms/reminders.test.ts`. Fixture note: set `due_at = now() - interval '2 days'` and `task.created_at = now() - interval '30 days'` so **all three** rungs (−7, −1, +1) have elapsed — that is the configuration that yields exactly 1 queued + 2 skipped. (With `due_at = now() - interval '1 day'` the +1 rung has not elapsed and the correct result is 1 queued + 1 skipped; the *rule* is identical. Assert "exactly one queued row and every other elapsed rung skipped".)
- `psql $SB_DEV -c "select status, count(*) from communication_logs where template_key='task_reminder' group by 1"` before/after a second `curl -XPOST …/api/jobs/reminders` — unchanged.
- `psql -c "insert into task_completions …"` then re-scan → `remindersEnqueued = 0`.
- Late-accept case: accept a seeded pending submission, then `curl -XPOST …/api/jobs/reminders` → one new `task_assigned` row for its primary contact **only** (fan-out rule).

## Guardrails
- **Burst-safe is the point.** Naïvely enqueuing every elapsed rung sends 3 emails to a judge the moment the seed loads. The "latest eligible rung only + retire the rest" rule is binding (PLAN §4/M36).
- **Skipped rows are permanent retirement, not a soft state.** They occupy the rung's unique key forever, which is exactly what prevents a later scan from firing it.
- **Suppression by materialization** uses `greatest(task.created_at, accepted_at)` — a task created today with a due date next week must never fire its −7d rung, and a speaker accepted today must not receive back-dated nags.
- **The fan-out rule (resolution #14) is consumed from `task_assignments_v`, never re-derived here.** Submission-targeted tasks assign to the primary contact only, once per accepted submission; contact-targeted tasks assign to members of `accepted_speakers_v`. If a count here disagrees with [M38](./M38-dashboard.md)'s dashboard or [M21](./M21-portal-shell.md)'s portal panel, the view is the truth and the divergence is a bug in the consumer.
- **Idempotency keys come from the frozen contracts builders** — no ad-hoc string concatenation, no "assignmentId" (assignments are lazy view rows with no PK).
- **Reminders and `task_assigned` are never enqueued by domain code** (PLAN §2). If a WS-C/WS-D module offers to enqueue on accept or on task create, refuse — that reintroduces the staleness class and a fifth `withTx` path.
- **Send-time re-check still happens in the dispatcher** ([M34](./M34-comms-outbox-dispatcher.md) step 3): a task completed between scan and send lands as `skipped`. Scan-time filtering is the first net, not the only one.
- **Unsubscribed contacts** are handled at dispatch (reminder-class only), not here — one rule, one place.
- Edge cases: `due_at IS NULL` → the task never participates in the ladder (assert this; a NULL due date must not throw or fire immediately); a disabled `reminder_rule` disappears from the ladder with no cleanup; an admin reopening a completion does **not** re-nag (keys already used stay used — documented, accepted); DST — offsets use `make_interval(days => n)` on `timestamptz`, which is calendar-day arithmetic in the DB's UTC frame; the human-facing due date is rendered via `time.ts`'s `endOfDayInTz`/`formatInZone` upstream in [M23](./M23-tasks-admin.md).
- **Budget the scan** (500 / 1000 rows) so a huge event cannot blow the 30 s CPU limit; the next tick resumes.

## If blocked
- Blocked on [M34](./M34-comms-outbox-dispatcher.md): the entire pass-2 SELECT (step 3) is pure SQL against [M03](./M03-db-schema-migrations.md)'s views and can be developed and unit-tested in PGlite with hand-inserted `communication_logs` rows.
- Blocked on [M03](./M03-db-schema-migrations.md)'s `task_assignments_v`: write the test fixtures and the rung-selection logic against a local CTE that mimics the view, then delete the CTE.
- Blocked on real tasks: the seeded 3 tasks (one overdue) are the intended fixture — nothing from [M23](./M23-tasks-admin.md)/[M25](./M25-task-runtime.md) is required.
- Ahead of schedule: finish [M35](./M35-ics-calendar-invites.md)'s Sunday lifecycle test, or start [M38](./M38-dashboard.md)'s overview SQL (it reads the same `task_assignments_v` and `speaker_outstanding_v`, so the counting rule you internalize here transfers directly).
