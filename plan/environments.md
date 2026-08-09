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
| Preview/test | Playwright, integration, and team demos | `sb-test` | `sb-web-preview` / `sb-jobs-preview` | `sb-files-preview` | **Current: `EMAIL_MODE=send` behind a one-address `EMAIL_ALLOWLIST`** (since #50; real delivery proven at status rev. 7) | `TEST_AUTH=1` only while the isolated e2e environment needs it — a release gate before any customer-facing use; fallback UI allowed |
| Production/judge | Submission URL and external judging | `sb-prod` | `sb-web` / `sb-jobs` | `sb-files` | `EMAIL_MODE=send`, allowlist empty, verified sender domain | `TEST_AUTH` unset; `EMAIL_FALLBACK_UI=0` |

Production must never expose the test-login route, a fixed OTP, or an inline OTP/magic-link
fallback. Real delivery is now verified from the preview (`mail.openboard.events`, SPF/DKIM
aligned, Gmail delivery — status rev. 7); the remaining email track is Outlook, calendar
invites, DMARC, and a production key. Preview-only fallbacks are evidence aids, not substitutes
for production authentication.

## 3. Canonical names

| Resource | Preview/test | Production |
|---|---|---|
| Web worker | `sb-web-preview` | `sb-web` |
| Jobs worker | `sb-jobs-preview` | `sb-jobs` |
| R2 bucket | `sb-files-preview` | `sb-files` |
| Neon database/branch | `sb-test` | `sb-prod` |

Local database work uses `sb-dev`; destructive experiments may use disposable Neon
branches. The checked-in Wrangler base configuration represents safe local defaults, and
named `preview` / `production` environments receive the exact deployed URL from the guarded
deploy script rather than storing a placeholder `workers.dev` hostname.

## 4. Runtime inventory

### `sb-web`

| Name | Kind | Required where | Purpose |
|---|---|---|---|
| `APP_ENV` | variable | preview and production | Exactly `preview` or `production` when deployed; omitted local input defaults to `local` |
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
| `NEON_TEST_URL` | protected GitHub `preview` environment secret | Direct/appropriate URL used to reset and migrate `sb-test` for protected preview E2E; never available to credential-free CI |
| `CLOUDFLARE_API_TOKEN` | protected GitHub deployment environment | Least-privilege Workers/R2 deployment token |
| `CLOUDFLARE_ACCOUNT_ID` | protected GitHub deployment variable or secret | Account targeted by Wrangler |
| `E2E_BASE_URL` | protected GitHub `preview` environment variable | Deployed preview exercised by Playwright |
| `NEXT_PUBLIC_BUILD_SHA` | CI build/deploy variable | Public commit identifier embedded in the build and health response |

Validation CI is credential-free and uses only repository/event metadata such as the build
SHA. Protected preview E2E and deployment workflows read credentials only from the matching
GitHub `preview` / `production` environment; require a reviewer for production.
Automatic production deploys remain gated by repository variable
`PRODUCTION_DEPLOY_ENABLED=1` until manual provisioning proof is complete.

## 5. Service setup

### Cloudflare Workers

Start on Workers Free. The deployed artifact (version `5e809b64`, status rev. 7) measures
`1679 KiB` gzip, below Free's 3 MB compressed-worker limit (earlier snapshots measured
~1205 KiB; the artifact grows as features land). Free also covers this project's two workers
and one cron trigger.

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

## 6. Provisioning state: preview done, production outstanding

The checked-in configuration now matches this contract:

- Wrangler uses canonical local/preview/production Worker names and isolated R2 buckets;
- deploys require the exact matching HTTPS web origin instead of a guessed hostname;
- the web config has complete named environments and a self-service binding for the
  in-memory OpenNext revalidation queue;
- `.dev.vars.example` and the typed runtime validator cover the committed inventory and
  enforce stricter production rules;
- validation CI checks generated bindings and Worker size, while the protected deploy
  workflow orders Neon migration → web → jobs → smoke.

**Preview is fully provisioned and deployed** (status §2a/§7): preview Workers live, both R2
buckets created with exact-origin CORS, Neon `sb-dev`/`sb-test` migrated and seeded, preview
Worker secrets set, protected GitHub environments created, and `mail.openboard.events` verified
in Resend with SPF/DKIM aligned. **Production remains outstanding**: `sb-prod` migration,
production secrets (`SESSION_SECRET`, `CRON_SECRET`, Neon URLs, R2 S3 credentials, Resend key),
and a green `Deploy` workflow run. Follow [`../docs/provisioning.md`](../docs/provisioning.md).
