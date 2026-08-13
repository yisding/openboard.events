# Provisioning Cloudflare and Neon

This is the operator checklist for taking the repository from configuration-ready to a
deployed preview and production environment. Check an item only after the external action
or named proof is complete. Cloudflare Git integration stays disabled: the protected
GitHub Actions workflow owns the required migration → web → jobs → smoke order.

## 0. Land the deployment configuration

- [x] Merge PR 6 into `main`.
- [x] Merge PR 7, the infrastructure reconciliation PR, into `main`.
- [x] Pull the resulting `main` branch and confirm the worktree is clean.
- [x] Run the credential-free validation in the same order as CI:

  ```bash
  pnpm install --frozen-lockfile
  pnpm release:check
  ```

`pnpm release:check` orders the gates deliberately: it checks generated Cloudflare types with
local artifacts hidden, then builds once before checking browser and Worker size budgets and
running the local-workerd artifact smoke. The Worker build temporarily isolates ignored local
`.dev.vars`/`.env*` files, so the release artifact is derived from committed configuration and
explicit process environment only. The same boundary covers the OpenNext deploy helper's cache
population step; the files are restored even when either command fails.

## 1. Record the environment map

- [x] Read the account's real `workers.dev` subdomain from the Cloudflare dashboard:
  `yi-ding.workers.dev`.
- [x] Record the exact preview origin as `https://sb-web-preview.yi-ding.workers.dev`.
- [x] Record the exact production origin as `https://openboard.events`.
- [x] Keep each origin as HTTPS only, with no path and no trailing slash.
- [x] Encode those exact origins in `scripts/deploy-cloudflare.sh`; a preview/production
  mismatch now fails before either Worker can be changed.

| Resource | Preview | Production | Local/development |
|---|---|---|---|
| Cloudflare web Worker | `sb-web-preview` | `sb-web` | `sb-web-local` |
| Cloudflare jobs Worker | `sb-jobs-preview` | `sb-jobs` | `sb-jobs-local` |
| R2 bucket | `sb-files-preview` | `sb-files` | `sb-files-dev` (bound in `wrangler.jsonc`; simulated locally by Wrangler) |
| Neon database/branch | `sb-test` | `sb-prod` | `sb-dev` |

Workers Free is the intended starting plan. `pnpm worker:size` fails at the 3 MiB compressed
limit and warns at 2.5 MiB. Upgrade only if that warning fires or deployed SSR/database
probes exceed the Free CPU allowance. Enabling R2 billing, if Cloudflare requests it before
issuing R2 credentials, is separate from upgrading the Workers plan.

## 2. Generate and store values safely

- [x] Generate an independent preview `SESSION_SECRET` of at least 32 random characters.
- [ ] Generate an independent production `SESSION_SECRET` of at least 32 random characters.
- [x] Generate an independent preview `CRON_SECRET` of at least 32 random characters.
- [ ] Generate an independent production `CRON_SECRET` of at least 32 random characters.
- [ ] Generate independent preview `UNSUBSCRIBE_SECRET` and `SPEAKER_SHARE_SECRET` values of at
  least 32 random characters. They sign different public payloads and must not reuse
  `SESSION_SECRET` or one another.
- [ ] Create the preview webhook in Resend and copy its provider-issued signing secret into
  `RESEND_WEBHOOK_SECRET`; do not generate or substitute this value locally.
- [ ] Generate an independent production `UNSUBSCRIBE_SECRET` of at least 32 random characters.
- [ ] Generate an independent production `SPEAKER_SHARE_SECRET` of at least 32 random characters.
- [ ] Create the production webhook in Resend and copy its provider-issued signing secret into
  `RESEND_WEBHOOK_SECRET`; do not reuse the preview webhook or its secret.
- [ ] Store the values in a password manager; do not commit them or paste them into issue or
  PR comments.

One suitable generator is:

```bash
openssl rand -base64 48
```

Within one environment, the web and jobs Workers must use the same `CRON_SECRET`. Preview
and production must use different values.

## 3. Provision Neon

- [x] Create one Neon project and create `sb-dev`, `sb-test`, and `sb-prod` as isolated
  databases/branches, or use separate projects if stronger isolation is preferred.
- [ ] For each environment, save its pooled URL. Its hostname contains `-pooler`; this becomes
  the web Worker's `DATABASE_URL` secret.
- [ ] For each environment, save its direct URL. This becomes local or GitHub
  `DATABASE_URL_DIRECT` and is used only for migrations.
- [x] Create a disposable Neon branch and apply the committed migrations there first.
- [x] Apply the migrations to `sb-dev`.
- [x] Apply the migrations to `sb-test` before the first preview deployment.
- [x] Leave `sb-prod` migration to the guarded production deployment step.
- [x] Confirm no destructive test or reset command points at `sb-prod`.

Run a migration by exporting the matching direct URL in a credentialed shell:

```bash
export DATABASE_URL_DIRECT='postgresql://...direct-neon-host...'
pnpm db:migrate
```

Never put `DATABASE_URL_DIRECT` on a Worker. Never use a pooled URL for migrations.

## 4. Provision Cloudflare and R2

- [x] Confirm the Cloudflare account ID and save it as `R2_ACCOUNT_ID` for runtime use.
- [x] Create the `sb-files-preview` bucket.
- [x] Create the `sb-files` bucket.
- [ ] Optionally create `sb-files-dev` for real local presign/CORS testing; normal local work
  can use Wrangler-local R2.
- [x] Create separate Object Read & Write S3 credentials scoped to `sb-files-preview`.
- [ ] Create separate Object Read & Write S3 credentials scoped to `sb-files`.
- [ ] Save each access-key ID and secret access key when Cloudflare displays them. Never
  reuse production credentials in preview.
- [x] Configure preview bucket CORS with only the exact preview origin.
- [x] Configure production bucket CORS with only the exact production origin.

Use this policy for each bucket, replacing the origin with the matching exact web origin:

```json
[
  {
    "AllowedOrigins": ["https://sb-web-preview.yi-ding.workers.dev"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The `FILES` and `NEXT_INC_CACHE_R2_BUCKET` bindings are already mapped to the matching
bucket in `wrangler.jsonc`. `R2_BUCKET_NAME` is validated at runtime so a cross-environment
bucket mix-up fails closed.

- [ ] Provision the R2 lifecycle rule(s) described in
  [`runbooks/r2-lifecycle.md`](./runbooks/r2-lifecycle.md) on both buckets — defense in depth
  behind the app-level orphan-staging sweep (`cleanupOrphans`, already running on the daily
  cleanup cron), not a substitute for it. That doc also records a real key-scheme finding
  (M07-owned follow-up) that limits what a single static rule can cover today.

## 5. Create the Cloudflare deployment token

- [ ] Create a least-privilege Cloudflare API token that can deploy Workers and use the
  required R2 bindings in this account.
- [x] Save the token as `CLOUDFLARE_API_TOKEN`; do not use the global API key. It is
  currently repository-scoped in GitHub; move it to both protected environments before
  production and then remove the repository-scoped copy.
- [x] Save the account ID as `CLOUDFLARE_ACCOUNT_ID`.
- [ ] Confirm Cloudflare's repository/Git integration is disabled.

## 6. Bootstrap preview

Finish sections 0–5 and migrate `sb-test` before starting this section.

- [x] Export the exact preview values in the credentialed shell:

  ```bash
  export APP_BASE_URL='https://sb-web-preview.yi-ding.workers.dev'
  export R2_ACCOUNT_ID='your-cloudflare-account-id'
  ```

- [x] Bootstrap the web Worker. A temporary unhealthy response is expected until its secrets
  exist:

  ```bash
  ALLOW_MISSING_DEPLOY_SECRETS=1 pnpm deploy:web:preview
  ```

- [ ] Complete the required secret inventory on `sb-web-preview`. The original baseline secrets
  are present; `UNSUBSCRIBE_SECRET`, `RESEND_WEBHOOK_SECRET`, and `SPEAKER_SHARE_SECRET` remain to
  be added before the next application deploy:

  | Secret | Value |
  |---|---|
  | `DATABASE_URL` | `sb-test` pooled Neon URL |
  | `SESSION_SECRET` | preview session secret |
  | `CRON_SECRET` | preview cron secret |
  | `UNSUBSCRIBE_SECRET` | preview unsubscribe-token secret |
  | `RESEND_WEBHOOK_SECRET` | provider-issued preview Resend webhook signing secret |
  | `SPEAKER_SHARE_SECRET` | preview speaker-share token secret |
  | `R2_ACCESS_KEY_ID` | preview bucket credential |
  | `R2_SECRET_ACCESS_KEY` | preview bucket credential |
  | `RESEND_API_KEY` | domain-scoped sending key (preview runs `EMAIL_MODE=send` behind a one-address allowlist since #50) |
  | `GOOGLE_CLIENT_ID` | Google OAuth web-client identifier |
  | `GOOGLE_CLIENT_SECRET` | Google OAuth web-client secret |

  ```bash
  pnpm exec wrangler secret put DATABASE_URL --env preview
  pnpm exec wrangler secret put SESSION_SECRET --env preview
  pnpm exec wrangler secret put CRON_SECRET --env preview
  pnpm exec wrangler secret put UNSUBSCRIBE_SECRET --env preview
  pnpm exec wrangler secret put RESEND_WEBHOOK_SECRET --env preview
  pnpm exec wrangler secret put SPEAKER_SHARE_SECRET --env preview
  pnpm exec wrangler secret put R2_ACCESS_KEY_ID --env preview
  pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY --env preview
  pnpm exec wrangler secret put RESEND_API_KEY --env preview
  pnpm exec wrangler secret put GOOGLE_CLIENT_ID --env preview
  pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET --env preview
  ```

- [ ] Redeploy the preview web Worker after the complete inventory exists:

  ```bash
  pnpm deploy:web:preview
  ```

- [x] For the first jobs deployment, create a mode-0600 transient secrets file containing
  only the matching preview cron secret. Keep it outside the repository and retain the
  resolved path for both deployment and cleanup:

  ```bash
  export JOBS_SECRETS_DIR="$(mktemp -d "${HOME}/Code/sb-deploy-secrets.XXXXXX")"
  export JOBS_SECRETS_FILE="$JOBS_SECRETS_DIR/jobs-preview.env"
  umask 077
  ```

  ```dotenv
  CRON_SECRET=replace-with-the-preview-cron-secret
  ```

- [x] Create `sb-jobs-preview` with its secret already attached so the cron never starts
  unauthenticated:

  ```bash
  pnpm exec wrangler deploy \
    --config workers/jobs/wrangler.jsonc \
    --env preview \
    --var "APP_BASE_URL:$APP_BASE_URL" \
    --secrets-file "$JOBS_SECRETS_FILE"
  ```

- [x] Confirm `sb-jobs-preview` has only `APP_BASE_URL` and `CRON_SECRET`; do not copy database,
  session, R2, Resend, or Airtable credentials to it.
- [x] Run the preview smoke check. Without the `SMOKE_*` fixture ids the dashboard,
  submit-form, and headshot checks skip instead of running; `--strict` turns any skip into a
  failure, which is how the deploy workflow runs it:

  ```bash
  while IFS= read -r line; do export "${line?}"; done < <(pnpm --silent smoke:fixture-ids)
  bash scripts/post-deploy-smoke.sh "$APP_BASE_URL" --strict
  ```

- [x] Inspect Workers logs and record a successful scheduled jobs tick.
- [x] Remove the exact external file and its now-empty directory after the secret is safely
  stored elsewhere:

  ```bash
  shred -u "$JOBS_SECRETS_FILE"
  rmdir "$JOBS_SECRETS_DIR"
  unset JOBS_SECRETS_FILE JOBS_SECRETS_DIR
  ```

- [x] Seed the non-production databases — `APP_ENV=local DATABASE_URL=<sb-dev pooled URL>
  pnpm seed` and `APP_ENV=preview DATABASE_URL=<sb-test pooled URL> pnpm seed` (add `--wipe` to
  reset first). The seed refuses an unclassified `APP_ENV` and refuses any database whose own
  `app.environment` marker disagrees.
- [x] Create the password-backed organizer and reviewer accounts
  (`pnpm admin:bootstrap`; first run in the project's history at rev. 7, on both branches —
  credentials held outside the repository).

Subsequent jobs deployments can use `pnpm deploy:jobs:preview`; Wrangler preserves the
existing Worker secret. The jobs Worker uses `global_fetch_strictly_public` because its
documented `APP_BASE_URL` is a sibling Worker on the same `workers.dev` zone; without that
flag Cloudflare rejects the scheduled subrequest with error 1042.

## 7. Configure protected GitHub environments

- [x] Create GitHub environments named exactly `preview` and `production`.
- [x] Require a reviewer for `production`.
- [x] Restrict `production` deployments to `main`.
- [ ] Add these secrets to both environments:

  | GitHub environment secret | Preview value | Production value |
  |---|---|---|
  | `CLOUDFLARE_API_TOKEN` | scoped Cloudflare token | scoped Cloudflare token |
  | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | Cloudflare account ID |
  | `DATABASE_URL_DIRECT` | `sb-test` direct Neon URL | `sb-prod` direct Neon URL |
  | `E2E_RESEND_API_KEY` | optional preview-only, read-capable Resend key for the sent-email delivery probe | unset |

  The preview E2E job derives `NEON_TEST_URL` from the `DATABASE_URL_DIRECT` secret
  (`.github/workflows/deploy.yml`); do not store a second copy.

- [ ] Add these environment variables:

  | GitHub environment variable | Preview | Production |
  |---|---|---|
  | `APP_BASE_URL` | exact preview origin | exact production origin |
  | `R2_ACCOUNT_ID` | Cloudflare account ID | Cloudflare account ID |
  | `E2E_SIGNUP_EMAIL` | optional dedicated address included in preview's exact email allowlist | unset |

  `E2E_BASE_URL` is derived from `APP_BASE_URL` for the preview E2E job and defaults to the
  preview origin in `playwright.config.ts` — do not add it. `EMAIL_FROM` also needs no entry:
  the sender lives in `wrangler.jsonc`'s vars for both environments (the address contains angle
  brackets, which cannot survive `--var`, so `scripts/deploy-cloudflare.sh` only verifies it is
  present in config before a production deploy). Leave `EMAIL_ALLOWLIST` unset too — the
  one-address preview allowlist is committed in `wrangler.jsonc`, and a GitHub value silently
  overrides it. Leave the `SMOKE_*` variables unset: the deploy workflow fills each unset one
  from `pnpm smoke:fixture-ids`; set one only to deliberately override a fixture.

  Every preview deploy runs the complete signup → activation → organization → event → public CFP
  → first proposal browser journey. With no E2E mailbox credentials, it uses the preview-only
  activation and OTP fallback plus the reserved `e2e-self-service@openboard.invalid` address, so
  the product journey remains a credential-free deployment gate. Configure both optional E2E
  values to make the same journey additionally prove delivery through Resend; configuring only
  one deliberately falls back instead of partially exercising the provider path.

- [x] Leave the repository variable `PRODUCTION_DEPLOY_ENABLED` unset. While it is unset, a
  successful `main` CI run deploys `preview` only.
- [ ] Merge to `main` (or run the `Deploy` workflow for `preview`) and verify the automatic
  migration → web → jobs → smoke succeeds. The `preview` environment must have no required
  reviewer, or every merge will queue an approval instead of deploying.
- [ ] Confirm an automatic deployment for a superseded `main` SHA reports that it was
  skipped before checkout, migration, or deployment. Do not remove this freshness gate or
  change deployment concurrency to cancel an in-progress migration/deploy.

Validation CI is credential-free. Runtime application secrets live in Cloudflare; GitHub
stores only the credentials and direct database URL needed by the deployment workflow.

## 8. Provision Resend before production

- [x] Verify a dedicated sending subdomain in Resend (`mail.openboard.events`, status rev. 7).
- [x] Publish and verify SPF and DKIM (aligned; proven with delivered Gmail mail).
- [ ] Confirm the DMARC policy and record `dmarc=pass` evidence.
- [x] Choose a real `EMAIL_FROM` mailbox or alias on that domain
  (`AI.Engineer Sandbox <hello@mail.openboard.events>`).
- [ ] Create the production `RESEND_API_KEY` (the preview uses a domain-scoped key).
- [x] Prove OTP delivery in a fresh Gmail inbox (`portal_login` + `submission_received`,
  status rev. 7).
- [ ] Prove OTP and calendar REQUEST/reschedule/CANCEL delivery in a fresh **Outlook** inbox,
  and calendar delivery in Gmail.
- [ ] Record the remaining alignment evidence in `DECISIONS.md`.

## 9. Deploy production manually

- [ ] Confirm `sb-prod`, `sb-files`, production CORS, Resend, and GitHub production protection
  are ready.
- [ ] Bootstrap `sb-web`, then set its runtime secrets exactly as for preview, using the
  production values plus `RESEND_API_KEY`.
- [ ] Confirm production uses `EMAIL_MODE=send`, `EMAIL_FALLBACK_UI=0`, no `TEST_AUTH`, and no
  `EMAIL_ALLOWLIST`.
- [ ] Create `sb-jobs` with the production `CRON_SECRET` attached on its first deploy, using
  the same `--secrets-file` pattern as preview with `--env production`.
- [ ] Manually run the `Deploy` workflow for `production` and approve its protected
  environment gate.
- [ ] Confirm migration → web → jobs → smoke succeeds.
- [ ] Confirm the real production health response and jobs cron logs.
- [ ] Only after both preview and production are proven, add the repository variable
  `PRODUCTION_DEPLOY_ENABLED=1` to enable successful `main` CI runs to deploy production. The
  production deploy then runs as a second leg after `preview`, and a failed preview stops it.

Production web secrets are:

| Secret | Required |
|---|---:|
| `DATABASE_URL` (pooled `sb-prod` URL) | yes |
| `SESSION_SECRET` | yes |
| `CRON_SECRET` | yes |
| `UNSUBSCRIBE_SECRET` | yes |
| `RESEND_WEBHOOK_SECRET` | yes |
| `SPEAKER_SHARE_SECRET` | yes |
| `R2_ACCESS_KEY_ID` | yes |
| `R2_SECRET_ACCESS_KEY` | yes |
| `RESEND_API_KEY` | yes |
| `GOOGLE_CLIENT_ID` | yes |
| `GOOGLE_CLIENT_SECRET` | yes |
| `AIRTABLE_API_KEY` | only if the deferred M39 integration is enabled |

`pnpm deploy:preflight web|jobs preview|production` compares the required names — the eleven in
`WEB_DEPLOY_SECRET_NAMES` for web, `CRON_SECRET` for jobs — with Cloudflare's secret names
without reading any secret value; the optional `AIRTABLE_API_KEY` is not part of that check. Both the protected deploy workflow and the local
deploy wrapper run it before release. `ALLOW_MISSING_DEPLOY_SECRETS=1` exists only for the first
bootstrap of a Worker that does not exist yet; after that first deploy, provision the complete
inventory before deploying application code again.

`pnpm db:migrate` first verifies every applied migration's content hash and order against the
checkout. The repository once carried future-dated `when` values, so an existing database can
have a future high-water mark even though the committed journal is now repaired. The wrapper
leaves that database journal untouched and gives only pending entries in an ephemeral journal a
timestamp above the existing high-water mark before invoking Drizzle. This both lets new
migrations run and keeps older rollback checkouts from mistaking applied DDL for pending work. A
missing, extra, or changed hash fails closed; the ephemeral files live under `~/Code` and are
removed after the command.

## 10. Record deployment proof

A successful deploy is not the full hackathon infrastructure proof.

- [x] Record the real Neon health response in `DECISIONS.md`.
- [ ] Record R2 ISR behavior.
- [ ] Record a browser presigned upload/CORS probe, including `ETag` visibility.
- [x] Record jobs tail output showing authenticated scheduled calls.
- [x] Record Workers compressed size and deployed CPU/resource-limit observations.
- [ ] Record the Resend DNS and Gmail/Outlook delivery evidence.
- [x] Record the final preview URL without recording any secret values; record production
  after its first successful deployment.
