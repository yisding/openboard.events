# Alerting thresholds

What to page on, what to only log, and where each signal comes from. Two automated alerting
paths plus one Cloudflare runtime failure signal exist today, and this file is the index between
them:

1. **Uptime/health-based** — `.github/workflows/uptime.yml` polls `/api/health` on a schedule and
   fails the workflow run when a threshold below is breached. A failed scheduled GitHub Actions
   run notifies the repository's default notification recipients (watchers, and whoever is
   configured under the repo's own Settings → Notifications) with no further setup — that failure
   *is* the alert today. A Slack/PagerDuty webhook step can be added to the same job later without
   changing anything in this file's thresholds; see the workflow's own header comment for where.

   **Which origins are polled is configuration with fail-safe defaults.** The workflow reads the
   repository variables `UPTIME_PREVIEW_URL` and `UPTIME_PRODUCTION_URL` when present; otherwise it
   polls the canonical deployed origins committed in the workflow (workers.dev preview and the
   `openboard.events` production custom domain). Both environments
   run on every schedule and neither can be silently skipped because a repository variable is
   missing. Override a default only when the corresponding deployment origin changes.
2. **Unexpected-error-based** — `src/shared/lib/error-tracking.ts`'s `captureError` is the single
   seam every unmapped `INTERNAL` error (`defineHandler` and the private job runner) flows through. Next's
   `instrumentation.ts` adds uncaught renders, Server Actions, middleware, and unwrapped route
   failures. Raw messages and stacks remain in structured Cloudflare Workers Logs; deployed
   invocations use `ctx.waitUntil()` to aggregate only a SHA-256 fingerprint, feature, route,
   code, minute, and count in `operational_error_buckets`. `feature` and `route` are derived from
   the request path (`/api/internal/<feature>/…`), so a paged operator can name the endpoint that
   broke without grepping Workers Logs by timestamp; `route` is always the *pattern*
   (`/api/internal/forms/[formId]/fields`), never a concrete path, and is `''` for the callers with
   no request to name (job sweeps, the R2 seam). `/api/health` publishes only the last-hour
   count — the attribution columns stay server-side. The scheduled uptime check fails on one or more unexpected errors, so this path is an
   automated alert rather than a dashboard-reading procedure. Rows older than seven days are
   removed by the daily cleanup job.
3. **Scheduled-dispatch status** — `workers/jobs/dispatch.ts` gives every RPC call a 120-second
   deadline, allows every due sibling to settle, and rejects the aggregate `waitUntil()` promise
   if any failed. Cloudflare records that rejection as a failed Cron Trigger invocation under
   **Workers & Pages → `sb-jobs[-preview]` → Triggers → Past Events**. Workers Logs receive
   `scheduled.job_complete`, `scheduled.job_failed`, or `scheduled.job_request_failed` with job,
   transport, status, and duration only; response bodies are never copied into the dispatcher log.
   A web-job 500 also reaches path 2 through `captureError`, but a binding or RPC failure may exist
   only in this Cloudflare status/log path. Past Events is currently a runtime signal, not
   an independently routed pager; inspect it during deployment and incident triage, and treat any
   failed invocation as an incident until an external Cloudflare notification is configured.

## `/api/health` thresholds

| Field | Healthy | Warn | Page / treat as incident | Why |
|---|---|---|---|---|
| HTTP status | `200` | — | non-`200`, or the request times out/errors | The route itself is unreachable — Worker down, DNS, or Cloudflare-side outage. |
| `ok` | `true` | — | `false` | The route's own outer catch fired — almost always `db.ok: false` below; see its body for the reason. |
| `db.ok` | `true` | — | `false` | Neon is unreachable or the configured `DATABASE_URL` is invalid. Every write and read in the product depends on this. |
| `db.version` present | non-empty string | — | missing/`"unknown"` while `db.ok: true` | Contradictory response — investigate rather than trust either half. |
| `errors` present | object | missing only during the additive one-deploy rollout | missing after the current release has passed strict post-deploy smoke | The strict smoke requires this field; the scheduled check warns rather than paging while an older artifact is still live. |
| `errors.ok` | `true` | — | `false` | The aggregate query failed, so caught application errors cannot reach the automated alert. Raw Cloudflare logs remain available, but silent monitor failure is itself an incident. |
| `errors.windowSeconds` | `3600` | — | missing or any other value | The polling threshold and the aggregation window have drifted; do not interpret `recentCount` until they agree. |
| `errors.recentCount` | `0` | — | `> 0` | These are unexpected 500-class failures, not validation/auth/user errors. On this low-traffic application, one caught failure is actionable. Start from `operational_error_buckets`, which now names the `feature` and `route` behind the count; `error.captured` logs carry the same two fields plus the raw message, stack, and the `x-request-id` the caller was given. Two background conditions also land here on purpose, because nothing else can retry them: a failed job sweep (`code` = `<job>.<sweep>`, e.g. `cleanup.retention`), and an R2 object left unreachable after its owning row was deleted (`code` = `R2_STRANDED_*`, one per originating sweep — `R2_STRANDED_CONTACT_ERASURE` is the compliance-relevant one). |
| `jobs` present | object | missing only during the additive one-deploy rollout | missing after the current release has passed strict post-deploy smoke | The strict smoke requires the field; a missing field is tolerated only while an older artifact remains live. |
| `jobs.ok` | `true` | — | `false` | The heartbeat query failed, so Cron liveness cannot be monitored independently of queue depth. |
| `jobs.outboxLastSuccessAgeSeconds` | `0`–`180` | `> 180` | missing/null or `> 300` | Outbox completes every minute even with no queued mail. Staleness therefore catches a stopped Cron, broken Service Binding/entrypoint, or private job failure when queue metrics remain empty. |
| `jobs.remindersLastSuccessAgeSeconds` / `cleanupLastSuccessAgeSeconds` | informational ages | — | specific failures page through `errors.recentCount` | These jobs run every 15 minutes and daily. Their ages accelerate diagnosis, while the every-minute outbox is the unambiguous scheduler-liveness threshold. |
| `jobs.airtableLastSuccessAgeSeconds` | `null` while `AIRTABLE_CRON=0`, informational age once enabled | — | do not page on this alone | `null` is the correct steady state for a switched-off integration, not a failure — `workers/jobs/dispatch.ts` reads the flag before ever dispatching, and `definePrivateJobRoute` additionally withholds the heartbeat from a tick whose stats say only `airtableSkippedDisabled`, so even a hand-curled `POST /worker-jobs/airtable` with the flag off leaves this field `null` rather than reading as a stale-but-once-successful job. Once `AIRTABLE_CRON=1`, treat a growing age past ~20 minutes (the job runs every 15) the same as `remindersLastSuccessAgeSeconds` above; specific sync failures still page through `errors.recentCount`, never through this field — under `feature` = `airtable` with `code` = `sync` (manual trigger) or `code` = `sweep` (cron trigger), both of which name the one event that failed. A sweep that fails *before* it reaches any event — the claim or the lease reap itself — never gets as far as that `captureError`, so it surfaces one level up through `settledJobStats` instead, under `feature` = `jobs` with `code` = `airtable.connections` (`<job>.<sweep>`, the same shape as `cleanup.retention`). Grep for the wrong `feature` there and a whole dead sweep looks like no errors at all. |
| `comms.ok` | `true` | `false` on one poll | treat as a page once it recurs across **multiple separate uptime-workflow runs** | The `communication_logs` aggregate query itself failed — table locked, migration mid-flight, or a real DB fault the version probe didn't happen to hit. `scripts/uptime-check.sh` annotates this as a warning rather than failing the run outright (see rationale below), so a recurring `comms.ok: false` shows up as repeated warnings in the workflow's run history — that history is what "recurs" means here; there is no automated run-counter. |
| `comms.queuedCount` | low double digits or less | `> 100` | `> 300` | The jobs Worker's cron claims up to 50 rows/minute (`dispatchOutboxIn`'s default budget) — a healthy dispatcher keeps this near zero between ticks. Sustained growth past 100 means sends are being enqueued faster than the dispatcher drains them, or the dispatcher has stopped running. |
| `comms.failedCount` | `0` | `> 10` | `> 50` | Terminal failures (`markFailure`'s `attempts >= 6` cutoff, or a non-retriable `AppError` code). A nonzero baseline is normal — a bad address, a disabled template — but a spike means a systemic problem: `RESEND_API_KEY` rotated/revoked, `EMAIL_FROM`/`EMAIL_REPLY_TO` broken, or the allowlist blocking every preview address. |
| `comms.authOutbox.queuedCount` | `0`–a handful | `> 25` | `> 100` | `admin_auth_email_outbox` — password resets, email verification, organization invitations. Its volume is a fraction of event mail (nobody sends it in bulk), so the thresholds sit an order of magnitude lower than `comms.queuedCount` above: twenty-five people waiting on a password reset is already an incident here, where twenty-five queued event emails is a Tuesday. |
| `comms.authOutbox.failedCount` | `0` | `> 3` | `> 10` | Terminal failures on the *recovery* path. This is the field that decides whether "the provider was down" is over: every row here is a person who asked to get back into their account and never got the mail. It never self-heals — `failRow` writes `status: "failed"` and only `pnpm auth:requeue` re-opens it — so unlike `comms.failedCount` a nonzero value stays nonzero until an operator acts. Treat any value as work to do, not a baseline. |
| `comms.authOutbox.oldestQueuedAgeSeconds` | under a couple of minutes | `> 900` (15 min) | `> 3600` (1 hour) | Same drain and the same retry ladder as event mail (`OUTBOX_MAX_ATTEMPTS` = 6, `2 ** attempts` minutes capped at 60), so the same reasoning about the page threshold sitting above the backoff cap applies. What differs is urgency below the threshold: a reset link has its own expiry, so a row queued for most of an hour may deliver a link that is already dead by the time it arrives. |
| `comms.oldestQueuedAgeSeconds` | under a couple of minutes | `> 900` (15 min) | `> 3600` (1 hour) | The cron ticks every minute (`workers/jobs/wrangler.jsonc`'s `* * * * *`); a row legitimately mid-retry backoff can sit `queued` up to 60 minutes past `created_at` (`markFailure`'s `2 ** attempts` minutes, capped at 60 — see that function's own comment). The 1-hour page threshold sits *above* that cap on purpose: below it, "oldest queued row" includes rows retrying exactly as designed, and paging on those would train whoever's on call to ignore this alert. |

### Requeueing the admin auth outbox

`comms.authOutbox.failedCount` is the only mail threshold with a manual remedy, because it is the
only one where nothing retries on its own:

```bash
pnpm auth:requeue                          # report every failed row: who, which template, what it died of
pnpm auth:requeue -- --email a@b.com       # narrow to one recipient
pnpm auth:requeue -- --apply               # re-open them; the every-minute drain does the rest
```

Reporting is the default and `--apply` is opt-in on purpose — this re-sends real mail to real
people, so the blast radius comes before the action. Rows whose sealed link payload is gone are
reported as unrecoverable rather than re-sent: the link *is* the message for all three templates,
so redelivering one without its payload would give the recipient a mail that cannot do anything and
stop them waiting for a real one. Those people need a fresh reset or verification request instead.

Fix the cause before requeueing — a rotated `RESEND_API_KEY`, a broken `EMAIL_FROM`, an allowlist
excluding the address — or the requeued rows spend a fresh six-attempt ladder and land back in
`failed`.

`comms.ok: false` is deliberately never a first-failure page — unlike `db.ok`, a `commsHealth`
failure is caught in its own try/catch inside the route precisely so a transient lock contention
on `communication_logs` (e.g. a migration applying, or the dispatcher's own `for update skip
locked` claim overlapping the health probe's read) does not flip the whole service to "down." See
`commsHealth`'s own comment (`src/app/api/health/comms-health.ts`) for why the two failure paths are
independent. `scripts/uptime-check.sh` reflects this in its exit codes: `warn`-tier breaches
(including any `comms.ok: false`) print a `::warning::` annotation and exit `0`; only `page`-tier
breaches (or the route being unreachable, non-`200`, or `ok`/`db.ok` false) exit non-zero and fail
the workflow run.

## Deployment/build thresholds

| Signal | Threshold | Where |
|---|---|---|
| `pnpm worker:size` compressed bundle | warn `> 2.5 MiB`, fail `> 3 MiB` | `scripts/check-worker-size.sh`, already a CI gate (`.github/workflows/ci.yml`'s `artifacts` job) — listed here only so it appears in one place alongside the runtime thresholds, not duplicated as a new check. |
| Post-deploy smoke (`scripts/post-deploy-smoke.sh --strict`) | any failure or skip | `.github/workflows/deploy.yml`'s `Smoke test the deployed web worker` step (followed, on preview only, by the self-service signup journey) — a failed deploy workflow run is itself the alert; see `docs/runbooks/rollback.md` for the response. |
| Hostile sign-in burst | any non-`401`/`429`, fewer than 11 controlled `429`s out of 12, or p95 `> 5 s` | Preview deploy's `Prove hostile sign-in bursts stay controlled` step; inspect `auth.credential_*`, `auth.password_verification`, and the Cloudflare invocation outcome as described in `sign-in-capacity.md`. |
| Jobs Cron Trigger invocation | failed Past Events status, `scheduled.job_failed`, or `scheduled.job_request_failed` | Cloudflare `sb-jobs[-preview]` Past Events and Workers Logs. The private web runner owns raw error capture; dispatcher logs stay metadata-only. |
| DMARC sender alignment | any legitimate failure, any unapproved passing source, missing SPF/DKIM, or a Cloudflare configuration warning | Run the production-protected **DMARC operations** workflow and inspect Cloudflare **Email → DMARC Management** daily during a policy stage and weekly at steady state; follow [`dmarc.md`](./dmarc.md) for rollback. |

## R2 / storage

No R2-specific numeric threshold today — R2 has no request/error-rate metric surfaced through this app.
`comms.failedCount` above catches the downstream symptom of a broken sending path; a broken
*storage* path shows up as `INTERNAL` errors on the upload/finalize routes, which now increments
the automated `errors.recentCount` page above. See
[`r2-lifecycle.md`](./r2-lifecycle.md) for the orphan-object cleanup cadence, which is a hygiene
job, not an alerting signal — a growing bucket of unreclaimed staging objects costs storage, not
correctness.

## Data-recovery thresholds

There is no automated signal for "we need to restore from a backup" — that call is made by a
human noticing the *consequence* (bad data visible in the product, a support report, an incident
already under way via one of the thresholds above), not by a monitor. See
[`backup-restore.md`](./backup-restore.md) for the Neon PITR procedure and
[`pitr-rehearsal.md`](./pitr-rehearsal.md) for proving that procedure still works before it's ever
needed for real.

## Adding a new threshold

1. Add the field to `/api/health` (or wherever the signal lives) — additive only, never remove or
   rename an existing field without updating `scripts/post-deploy-smoke.sh` and
   `scripts/uptime-check.sh` in the same change (both key off the current shape).
2. Add a row to the table above with the same three-tier shape (healthy / warn / page) and a
   one-sentence "why," not just a number — a threshold with no rationale gets silently loosened
   the first time it's noisy.
3. Update `scripts/uptime-check.sh` to check it, and `.github/workflows/uptime.yml`'s header
   comment if the new field changes what "non-deploying, curl-based" needs to parse.
