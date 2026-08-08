# openboard — environments, bindings, and secrets

This is the canonical provisioning checklist for the hackathon. `PLAN.md` defines product
scope; this file defines where the app runs and which deployable receives each value.

## 1. Runtime topology

There are two deployables, but only one application runtime:

- `sb-web` is the OpenNext worker. It owns the UI, route handlers, database access, auth,
  uploads, email rendering/sending, calendar generation, and optional Airtable export.
- `sb-jobs` is a small scheduled worker. It owns no application logic and has no database,
  R2, Resend, or Airtable access. Every minute it POSTs the due
  `/api/jobs/{outbox|reminders|airtable|cleanup}` routes on `sb-web` with `CRON_SECRET`.

The two workers share exactly two configuration values within an environment:
`APP_BASE_URL` and `CRON_SECRET`. Preview and production use different secret values.

## 2. Environment matrix

| Environment | Purpose | Neon | Web / jobs | R2 | Email | Test bypasses |
|---|---|---|---|---|---|---|
| Local development | Feature work and unit/manual checks | `sb-dev` | `next dev` / `wrangler dev` | Wrangler-local R2; use `sb-files-dev` only for the real presign/CORS spike | `EMAIL_MODE=log` | `TEST_AUTH=1`; `EMAIL_FALLBACK_UI=1` allowed |
| Preview/test | Playwright, integration, and team demos | `sb-test` | `sb-web-preview` / `sb-jobs-preview` | `sb-files-preview` | `EMAIL_MODE=log`; temporary `send` only with a team-owned allowlist | `TEST_AUTH=1` only while the isolated e2e environment needs it; fallback UI allowed |
| Production/judge | Submission URL and external judging | `sb-prod` | `sb-web` / `sb-jobs` | `sb-files` | `EMAIL_MODE=send`, allowlist empty, verified sender domain | `TEST_AUTH` unset; `EMAIL_FALLBACK_UI=0` |

Production must never expose the test-login route, a fixed OTP, or an inline OTP/magic-link
fallback. If real delivery is not verified, CP1 and the minimum judging path remain red;
preview-only fallbacks are evidence aids, not substitutes for production authentication.

## 3. Canonical names

| Resource | Preview/test | Production |
|---|---|---|
| Web worker | `sb-web-preview` | `sb-web` |
| Jobs worker | `sb-jobs-preview` | `sb-jobs` |
| R2 bucket | `sb-files-preview` | `sb-files` |
| Neon database/branch | `sb-test` | `sb-prod` |

Local database work uses `sb-dev`; destructive experiments may use disposable Neon
branches. The checked-in Wrangler base configuration represents safe local defaults, and
named `preview` / `production` environments must contain real deployed URLs rather than
placeholder `workers.dev` hostnames.

## 4. Runtime inventory

### `sb-web`

| Name | Kind | Required where | Purpose |
|---|---|---|---|
| `DATABASE_URL` | secret | all | Pooled Neon runtime URL |
| `SESSION_SECRET` | secret | all | Session, OTP, and portal-token signing key |
| `RESEND_API_KEY` | secret | production; preview only for send tests | Resend API credential |
| `CRON_SECRET` | secret | deployed envs | Authenticates `/api/jobs/*`; same value on that environment's jobs worker |
| `R2_ACCOUNT_ID` | variable | real R2 presigning | Cloudflare account containing the bucket |
| `R2_ACCESS_KEY_ID` | secret | real R2 presigning | Bucket-scoped S3 credential |
| `R2_SECRET_ACCESS_KEY` | secret | real R2 presigning | Bucket-scoped S3 credential |
| `AIRTABLE_API_KEY` | secret | only if M39 is enabled | Airtable personal access token |
| `APP_BASE_URL` | variable | all | Absolute URL used in links, embeds, email, and ICS |
| `EMAIL_FROM` | variable | email-enabled envs | Address on the verified sending domain; freeze after the first invite |
| `EMAIL_MODE` | variable | all | Exactly `log` or `send` |
| `EMAIL_ALLOWLIST` | variable | optional preview sends | Exact addresses or domain suffixes allowed to receive test mail |
| `EMAIL_FALLBACK_UI` | variable | local/preview only | `1` may expose test delivery artifacts; production is `0` |
| `R2_BUCKET_NAME` | variable | real R2 presigning | Must match that environment's `FILES` binding bucket |
| `AIRTABLE_BASE_ID` | variable | only if M39 is enabled | Target Airtable base |
| `AIRTABLE_CRON` | variable | only if M39 is enabled | `1` enables the optional modulo cron; default `0` |
| `TEST_AUTH` | variable | local/isolated preview only | Enables test authentication; absent in production |

`FILES` and `NEXT_INC_CACHE_R2_BUCKET` are Wrangler R2 bindings, not secrets. Both point to
the environment's bucket; the OpenNext cache uses its own prefix. `ASSETS` is the generated
static-assets binding.

### `sb-jobs`

| Name | Kind | Required where | Purpose |
|---|---|---|---|
| `APP_BASE_URL` | variable | all | URL of the matching `sb-web` environment |
| `CRON_SECRET` | secret | all | Same value as the matching web worker |

Do not copy `DATABASE_URL`, Resend, R2, Airtable, or session credentials to `sb-jobs`.

### Local/CI-only values

| Name | Storage | Purpose |
|---|---|---|
| `DATABASE_URL_DIRECT` | local `.dev.vars` or protected GitHub deployment environment | Direct Neon URL for Drizzle migrations; never a Worker runtime secret |
| `NEON_TEST_URL` | GitHub Actions repository secret | Direct/appropriate URL used to reset and migrate `sb-test` for CI |
| `CLOUDFLARE_API_TOKEN` | protected GitHub deployment environment | Least-privilege Workers/R2 deployment token |
| `CLOUDFLARE_ACCOUNT_ID` | protected GitHub deployment variable or secret | Account targeted by Wrangler |
| `E2E_BASE_URL` | GitHub variable | Deployed preview exercised by Playwright |
| `NEXT_PUBLIC_BUILD_SHA` | CI build variable | Public commit identifier embedded in the walking skeleton/health UI |

`main` currently has no GitHub Actions workflow. PR #5 proposes validation-only CI and
consumes none of these deployment secrets. Add them only when a deploy job lands; prefer a
protected GitHub `production` environment for production migration/deploy credentials.

## 5. Service setup

### Cloudflare Workers

Start on Workers Free. As measured on Aug 8, the current OpenNext artifact is
`1122.48 KiB` gzip, below Free's 3 MB compressed-worker limit. Free also covers this
project's two workers and one cron trigger.

Re-run `wrangler deploy --dry-run` on every production candidate. Upgrade the account to
Workers Paid before judge deployment if either condition is true:

1. the compressed worker approaches the 3 MB Free ceiling (2.5 MB is the warning line); or
2. deployed SSR/auth/database probes exceed Free's 10 ms CPU allowance or produce resource
   limit errors.

After an upgrade, use 8 MiB as the warning budget beneath Paid's 10 MB compressed limit.
Workers Paid is a separate Workers subscription; a paid zone plan is not required.

### R2

- Create `sb-files-preview` and `sb-files` (plus optional `sb-files-dev`).
- Create separate read/write S3 credentials scoped to each bucket; never reuse production
  credentials in preview.
- Configure CORS for `PUT, GET` from the exact local/preview/production origins, allow the
  `content-type` request header, and set a 3600-second max age.
- Keep the `FILES`, `NEXT_INC_CACHE_R2_BUCKET`, and `R2_BUCKET_NAME` targets identical within
  each environment.

### Neon

- Create `sb-dev`, `sb-test`, and `sb-prod`.
- Use the pooled URL as `DATABASE_URL` at runtime and the direct URL only for migrations.
- Apply corrected migrations to a disposable database first, then dev, test, and production.
- CI resets only `sb-test`; no script may point destructive test/seed operations at `sb-prod`.

### Resend

- Verify a sending subdomain and publish SPF, DKIM, and DMARC.
- Use a real mailbox or alias for `EMAIL_FROM` and the ICS organizer identity.
- Prove aligned `spf=pass`, `dkim=pass`, and `dmarc=pass` from the production sender.
- Test OTP and the REQUEST/reschedule/CANCEL calendar lifecycle in fresh Gmail and Outlook
  inboxes before CP4.

### Airtable (deferred bonus)

- Use a personal access token, not a legacy API key.
- Required scopes are `data.records:write` and `schema.bases:read`; add
  `schema.bases:write` only for a provisioning script.
- Keep the token and base ID on `sb-web` only. Do not provision them until M39 is unpaused.

## 6. Current scaffold drift to fix in R1

As of the PR #3 baseline, checked-in runtime configuration does not yet match this contract:

- worker names are `openboard-web` / `openboard-jobs`, not the canonical names above;
- both R2 bindings and `.dev.vars.example` name `openboard-files`, not the separated buckets;
- web `APP_BASE_URL` is localhost and the jobs production URL is a placeholder;
- the web worker has no named preview/production environments;
- `.dev.vars.example` omits the optional `AIRTABLE_CRON=0` flag, while the typed env accessor
  exposes only `CRON_SECRET` despite the larger committed example;
- `main` has no CI/deployment workflow; PR #5's proposed workflow validates but does not
  install runtime secrets or deploy either worker.

These are explicit M01/M04/M07/M08 implementation gaps. This planning PR records them; it
does not disguise them by treating the current scaffold as provisioned infrastructure.
