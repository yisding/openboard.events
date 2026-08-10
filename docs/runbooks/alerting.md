# Alerting thresholds

What to page on, what to only log, and where each signal comes from. Two independent alerting
paths exist today, and this file is the index between them:

1. **Uptime/health-based** — `.github/workflows/uptime.yml` polls `/api/health` on a schedule and
   fails the workflow run when a threshold below is breached. A failed scheduled GitHub Actions
   run notifies the repository's default notification recipients (watchers, and whoever is
   configured under the repo's own Settings → Notifications) with no further setup — that failure
   *is* the alert today. A Slack/PagerDuty webhook step can be added to the same job later without
   changing anything in this file's thresholds; see the workflow's own header comment for where.
2. **Error-rate-based** — `src/shared/lib/error-tracking.ts`'s `captureError` is the single seam
   every unmapped `INTERNAL` error (`defineHandler`'s catch block, the job routes' catch block)
   flows through before it becomes the generic 500 the caller sees. It is console-only today
   (`console.error` with a structured JSON entry); wiring a real provider is confined to that one
   file per its own doc comment. Until that lands, "alerting" on this path means **reading the
   Cloudflare dashboard's Worker logs / `wrangler tail`**, not an automated page — recorded here so
   the gap is explicit rather than assumed-covered.

## `/api/health` thresholds

| Field | Healthy | Warn | Page / treat as incident | Why |
|---|---|---|---|---|
| HTTP status | `200` | — | non-`200`, or the request times out/errors | The route itself is unreachable — Worker down, DNS, or Cloudflare-side outage. |
| `ok` | `true` | — | `false` | The route's own outer catch fired — almost always `db.ok: false` below; see its body for the reason. |
| `db.ok` | `true` | — | `false` | Neon is unreachable or the configured `DATABASE_URL` is invalid. Every write and read in the product depends on this. |
| `db.version` present | non-empty string | — | missing/`"unknown"` while `db.ok: true` | Contradictory response — investigate rather than trust either half. |
| `comms.ok` | `true` | `false` on one poll | treat as a page once it recurs across **multiple separate uptime-workflow runs** | The `communication_logs` aggregate query itself failed — table locked, migration mid-flight, or a real DB fault the version probe didn't happen to hit. `scripts/uptime-check.sh` annotates this as a warning rather than failing the run outright (see rationale below), so a recurring `comms.ok: false` shows up as repeated warnings in the workflow's run history — that history is what "recurs" means here; there is no automated run-counter. |
| `comms.queuedCount` | low double digits or less | `> 100` | `> 300` | The jobs Worker's cron claims up to 50 rows/minute (`dispatchOutboxIn`'s default budget) — a healthy dispatcher keeps this near zero between ticks. Sustained growth past 100 means sends are being enqueued faster than the dispatcher drains them, or the dispatcher has stopped running. |
| `comms.failedCount` | `0` | `> 10` | `> 50` | Terminal failures (`markFailure`'s `attempts >= 6` cutoff, or a non-retriable `AppError` code). A nonzero baseline is normal — a bad address, a disabled template — but a spike means a systemic problem: `RESEND_API_KEY` rotated/revoked, `EMAIL_FROM` broken, or the allowlist blocking every preview address. |
| `comms.oldestQueuedAgeSeconds` | under a couple of minutes | `> 900` (15 min) | `> 3600` (1 hour) | The cron ticks every minute (`workers/jobs/wrangler.jsonc`'s `* * * * *`); a row legitimately mid-retry backoff can sit `queued` up to 60 minutes past `created_at` (`markFailure`'s `2 ** attempts` minutes, capped at 60 — see that function's own comment). The 1-hour page threshold sits *above* that cap on purpose: below it, "oldest queued row" includes rows retrying exactly as designed, and paging on those would train whoever's on call to ignore this alert. |

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
| Post-deploy smoke (`scripts/post-deploy-smoke.sh --strict`) | any failure or skip | `.github/workflows/deploy.yml`'s final step — a failed deploy workflow run is itself the alert; see `docs/runbooks/rollback.md` for the response. |

## R2 / storage

No numeric threshold today — R2 has no request/error-rate metric surfaced through this app.
`comms.failedCount` above catches the downstream symptom of a broken sending path; a broken
*storage* path shows up as elevated `INTERNAL` errors on the upload/finalize routes, which is the
error-tracking path (§ above), not a health-endpoint number. See
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
