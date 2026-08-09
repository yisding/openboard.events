# Provisioning Cloudflare and Neon

This is the operator checklist for taking the repository from configuration-ready to a
deployed preview and production environment. Check an item only after the external action
or named proof is complete. Cloudflare Git integration stays disabled: the protected
GitHub Actions workflow owns the required migration → web → jobs → smoke order.

## 0. Land the deployment configuration

- [x] Merge PR 6 into `main`.
- [ ] Merge PR 7, the infrastructure reconciliation PR, into `main`.
- [ ] Pull the resulting `main` branch and confirm the worktree is clean.
- [ ] Run the credential-free validation in the same order as CI:

  ```bash
  pnpm install --frozen-lockfile
  pnpm check
  pnpm cf-typegen:check
  pnpm worker:size
  ```

`pnpm check` must run before `pnpm cf-typegen:check` because the generated Cloudflare types
include the OpenNext worker built by `pnpm check`.

## 1. Record the environment map

- [x] Read the account's real `workers.dev` subdomain from the Cloudflare dashboard:
  `yi-ding.workers.dev`.
- [x] Record the exact preview origin as `https://sb-web-preview.yi-ding.workers.dev`.
- [x] Record the exact production origin as `https://sb-web.yi-ding.workers.dev`.
- [ ] Keep each origin as HTTPS only, with no path and no trailing slash.

| Resource | Preview | Production | Local/development |
|---|---|---|---|
| Cloudflare web Worker | `sb-web-preview` | `sb-web` | `sb-web-local` |
| Cloudflare jobs Worker | `sb-jobs-preview` | `sb-jobs` | `sb-jobs-local` |
| R2 bucket | `sb-files-preview` | `sb-files` | Wrangler-local storage; optional `sb-files-dev` |
| Neon database/branch | `sb-test` | `sb-prod` | `sb-dev` |

Workers Free is the intended starting plan. `pnpm worker:size` fails at the 3 MiB compressed
limit and warns at 2.5 MiB. Upgrade only if that warning fires or deployed SSR/database
probes exceed the Free CPU allowance. Enabling R2 billing, if Cloudflare requests it before
issuing R2 credentials, is separate from upgrading the Workers plan.

## 2. Generate and store values safely

- [ ] Generate an independent preview `SESSION_SECRET` of at least 32 random characters.
- [ ] Generate an independent production `SESSION_SECRET` of at least 32 random characters.
- [ ] Generate an independent preview `CRON_SECRET` of at least 32 random characters.
- [ ] Generate an independent production `CRON_SECRET` of at least 32 random characters.
- [ ] Store the values in a password manager; do not commit them or paste them into issue or
  PR comments.

One suitable generator is:

```bash
openssl rand -base64 48
```

Within one environment, the web and jobs Workers must use the same `CRON_SECRET`. Preview
and production must use different values.

## 3. Provision Neon

- [ ] Create one Neon project and create `sb-dev`, `sb-test`, and `sb-prod` as isolated
  databases/branches, or use separate projects if stronger isolation is preferred.
- [ ] For each environment, save its pooled URL. Its hostname contains `-pooler`; this becomes
  the web Worker's `DATABASE_URL` secret.
- [ ] For each environment, save its direct URL. This becomes local or GitHub
  `DATABASE_URL_DIRECT` and is used only for migrations.
- [ ] Create a disposable Neon branch and apply the committed migrations there first.
- [ ] Apply the migrations to `sb-dev`.
- [ ] Apply the migrations to `sb-test` before the first preview deployment.
- [ ] Leave `sb-prod` migration to the guarded production deployment step.
- [ ] Confirm no destructive test or reset command points at `sb-prod`.

Run a migration by exporting the matching direct URL in a credentialed shell:

```bash
export DATABASE_URL_DIRECT='postgresql://...direct-neon-host...'
pnpm db:migrate
```

Never put `DATABASE_URL_DIRECT` on a Worker. Never use a pooled URL for migrations.

## 4. Provision Cloudflare and R2

- [ ] Confirm the Cloudflare account ID and save it as `R2_ACCOUNT_ID` for runtime use.
- [ ] Create the `sb-files-preview` bucket.
- [ ] Create the `sb-files` bucket.
- [ ] Optionally create `sb-files-dev` for real local presign/CORS testing; normal local work
  can use Wrangler-local R2.
- [ ] Create separate Object Read & Write S3 credentials scoped to `sb-files-preview`.
- [ ] Create separate Object Read & Write S3 credentials scoped to `sb-files`.
- [ ] Save each access-key ID and secret access key when Cloudflare displays them. Never
  reuse production credentials in preview.
- [ ] Configure preview bucket CORS with only the exact preview origin.
- [ ] Configure production bucket CORS with only the exact production origin.

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

## 5. Create the Cloudflare deployment token

- [ ] Create a least-privilege Cloudflare API token that can deploy Workers and use the
  required R2 bindings in this account.
- [ ] Save the token as `CLOUDFLARE_API_TOKEN`; do not use the global API key.
- [ ] Save the account ID as `CLOUDFLARE_ACCOUNT_ID`.
- [ ] Confirm Cloudflare's repository/Git integration is disabled.

## 6. Bootstrap preview

Finish sections 0–5 and migrate `sb-test` before starting this section.

- [ ] Export the exact preview values in the credentialed shell:

  ```bash
  export APP_BASE_URL='https://sb-web-preview.yi-ding.workers.dev'
  export R2_ACCOUNT_ID='your-cloudflare-account-id'
  ```

- [ ] Bootstrap the web Worker. A temporary unhealthy response is expected until its secrets
  exist:

  ```bash
  pnpm deploy:web:preview
  ```

- [ ] Set these secrets on `sb-web-preview`:

  | Secret | Value |
  |---|---|
  | `DATABASE_URL` | `sb-test` pooled Neon URL |
  | `SESSION_SECRET` | preview session secret |
  | `CRON_SECRET` | preview cron secret |
  | `R2_ACCESS_KEY_ID` | preview bucket credential |
  | `R2_SECRET_ACCESS_KEY` | preview bucket credential |
  | `RESEND_API_KEY` | omit while preview remains in log mode |

  ```bash
  pnpm exec wrangler secret put DATABASE_URL --env preview
  pnpm exec wrangler secret put SESSION_SECRET --env preview
  pnpm exec wrangler secret put CRON_SECRET --env preview
  pnpm exec wrangler secret put R2_ACCESS_KEY_ID --env preview
  pnpm exec wrangler secret put R2_SECRET_ACCESS_KEY --env preview
  ```

- [ ] Redeploy the preview web Worker after its secrets exist:

  ```bash
  pnpm deploy:web:preview
  ```

- [ ] For the first jobs deployment, create a local `.env.jobs-preview` file containing only
  the matching preview cron secret. `.env*` is ignored by Git:

  ```dotenv
  CRON_SECRET=replace-with-the-preview-cron-secret
  ```

- [ ] Create `sb-jobs-preview` with its secret already attached so the cron never starts
  unauthenticated:

  ```bash
  pnpm exec wrangler deploy \
    --config workers/jobs/wrangler.jsonc \
    --env preview \
    --var "APP_BASE_URL:$APP_BASE_URL" \
    --secrets-file .env.jobs-preview
  ```

- [ ] Confirm `sb-jobs-preview` has only `APP_BASE_URL` and `CRON_SECRET`; do not copy database,
  session, R2, Resend, or Airtable credentials to it.
- [ ] Run the preview smoke check:

  ```bash
  bash scripts/post-deploy-smoke.sh "$APP_BASE_URL"
  ```

- [ ] Inspect Workers logs and record a successful scheduled jobs tick.
- [ ] Remove the local `.env.jobs-preview` after the secret is safely stored elsewhere.

Subsequent jobs deployments can use `pnpm deploy:jobs:preview`; Wrangler preserves the
existing Worker secret.

## 7. Configure protected GitHub environments

- [ ] Create GitHub environments named exactly `preview` and `production`.
- [ ] Require a reviewer for `production`.
- [ ] Restrict `production` deployments to `main`.
- [ ] Add these secrets to both environments:

  | GitHub environment secret | Preview value | Production value |
  |---|---|---|
  | `CLOUDFLARE_API_TOKEN` | scoped Cloudflare token | scoped Cloudflare token |
  | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | Cloudflare account ID |
  | `DATABASE_URL_DIRECT` | `sb-test` direct Neon URL | `sb-prod` direct Neon URL |

- [ ] Add these environment variables:

  | GitHub environment variable | Preview | Production |
  |---|---|---|
  | `APP_BASE_URL` | exact preview origin | exact production origin |
  | `R2_ACCOUNT_ID` | Cloudflare account ID | Cloudflare account ID |
  | `EMAIL_FROM` | omit while email is logged | verified production sender |
  | `EMAIL_ALLOWLIST` | only for deliberate real-send tests | unset |

- [ ] Leave the repository variable `PRODUCTION_DEPLOY_ENABLED` unset.
- [ ] Manually run the `Deploy` workflow for `preview` and verify migration → web → jobs →
  smoke succeeds.
- [ ] Confirm an automatic deployment for a superseded `main` SHA reports that it was
  skipped before checkout, migration, or deployment. Do not remove this freshness gate or
  change deployment concurrency to cancel an in-progress migration/deploy.

Validation CI is credential-free. Runtime application secrets live in Cloudflare; GitHub
stores only the credentials and direct database URL needed by the deployment workflow.

## 8. Provision Resend before production

- [ ] Verify a dedicated sending subdomain in Resend.
- [ ] Publish and verify SPF, DKIM, and DMARC.
- [ ] Choose a real `EMAIL_FROM` mailbox or alias on that domain.
- [ ] Create the production `RESEND_API_KEY`.
- [ ] Prove OTP and calendar REQUEST/reschedule/CANCEL delivery in fresh Gmail and Outlook
  inboxes.
- [ ] Record aligned `spf=pass`, `dkim=pass`, and `dmarc=pass` evidence in `DECISIONS.md`.

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
  `PRODUCTION_DEPLOY_ENABLED=1` to enable successful `main` CI runs to deploy production.

Production web secrets are:

| Secret | Required |
|---|---:|
| `DATABASE_URL` (pooled `sb-prod` URL) | yes |
| `SESSION_SECRET` | yes |
| `CRON_SECRET` | yes |
| `R2_ACCESS_KEY_ID` | yes |
| `R2_SECRET_ACCESS_KEY` | yes |
| `RESEND_API_KEY` | yes |
| `AIRTABLE_API_KEY` | only if the deferred M39 integration is enabled |

## 10. Record deployment proof

A successful deploy is not the full hackathon infrastructure proof.

- [ ] Record the real Neon health response in `DECISIONS.md`.
- [ ] Record R2 ISR behavior.
- [ ] Record a browser presigned upload/CORS probe, including `ETag` visibility.
- [ ] Record jobs tail output showing authenticated scheduled calls.
- [ ] Record Workers compressed size and deployed CPU/resource-limit observations.
- [ ] Record the Resend DNS and Gmail/Outlook delivery evidence.
- [ ] Record the final preview and production URLs without recording any secret values.
