# Provisioning Cloudflare and Neon

The repository is configuration-ready, but nothing in this document has been provisioned or deployed yet. Keep Cloudflare's Git integration disabled: the protected GitHub Actions deployment runs migrations, web, jobs, and smoke checks in that required order.

## 1. Accounts and environments

Create two protected GitHub environments named `preview` and `production`. Require a reviewer for production. Create these external resources:

| Provider | Preview | Production | Local/development |
|---|---|---|---|
| Cloudflare web Worker | `sb-web-preview` | `sb-web` | `sb-web-local` |
| Cloudflare jobs Worker | `sb-jobs-preview` | `sb-jobs` | `sb-jobs-local` |
| R2 bucket | `sb-files-preview` | `sb-files` | Wrangler-local storage; optional `sb-files-dev` |
| Neon database/branch | `sb-test` | `sb-prod` | `sb-dev` |

Workers Free is the intended starting plan. `pnpm worker:size` fails at the 3 MiB compressed limit and warns at 2.5 MiB. Upgrade only if that warning fires or deployed SSR/database probes exceed the Free CPU allowance.

## 2. Neon

For each Neon environment, save both connection strings:

- pooled connection string → the web Worker's `DATABASE_URL` secret;
- direct connection string → the matching GitHub environment's `DATABASE_URL_DIRECT` secret.

Never put `DATABASE_URL_DIRECT` on a Worker. Apply the two committed migrations to a disposable Neon branch first. The deployment workflow then runs `pnpm db:migrate` before changing either Worker.

## 3. R2

Create `sb-files-preview` and `sb-files`. Create separate bucket-scoped read/write S3 credentials for each environment. Configure bucket CORS for `PUT` and `GET` from only that environment's exact web origin, allow the `content-type` header, and use a 3600-second max age. Do not reuse production credentials in preview.

The `FILES` and `NEXT_INC_CACHE_R2_BUCKET` bindings are already mapped to the matching bucket in `wrangler.jsonc`. `R2_BUCKET_NAME` is also validated at runtime so a cross-environment bucket mix-up fails closed.

## 4. Worker secrets

Generate independent random values for preview and production. Within one environment, `CRON_SECRET` must be identical on web and jobs.

Set these on each web Worker from the repository root with `wrangler secret put NAME --env preview` or `--env production`:

| Secret | Preview | Production |
|---|---:|---:|
| `DATABASE_URL` (pooled) | required | required |
| `SESSION_SECRET` (32+ random characters) | required | required |
| `CRON_SECRET` (32+ random characters) | required | required |
| `R2_ACCESS_KEY_ID` | required | required |
| `R2_SECRET_ACCESS_KEY` | required | required |
| `RESEND_API_KEY` | only when testing sends | required |
| `AIRTABLE_API_KEY` | only if the bonus integration is enabled | only if enabled |

Set only `CRON_SECRET` on each jobs Worker, using `wrangler secret put CRON_SECRET --config workers/jobs/wrangler.jsonc --env preview` (or `production`). Do not copy database, session, R2, Resend, or Airtable credentials to jobs.

Production deliberately has no `TEST_AUTH`, uses `EMAIL_FALLBACK_UI=0`, and has no `EMAIL_ALLOWLIST`. Preview defaults to logged email and may use an allowlist for temporary real-send tests.

## 5. GitHub deployment environments

Add these secrets to both protected GitHub environments:

- `CLOUDFLARE_API_TOKEN` — least-privilege token that can deploy Workers and bind R2 in this account;
- `CLOUDFLARE_ACCOUNT_ID`;
- `DATABASE_URL_DIRECT` — the matching Neon direct URL.

Add these environment variables:

- `APP_BASE_URL` — the exact Wrangler-emitted HTTPS origin, with no path or trailing slash;
- `R2_ACCOUNT_ID` — the Cloudflare account containing the matching bucket;
- `EMAIL_FROM` — required in production and must use the verified Resend domain;
- `EMAIL_ALLOWLIST` — preview only, and only when `EMAIL_MODE=send` is deliberately enabled.

Read the account's actual `workers.dev` subdomain from the Workers dashboard; do not guess it. Combine it with the canonical Worker name, use that origin for the first manual web deploy, and confirm the emitted URL before saving it in GitHub or deploying jobs.

After preview and production have both been proven manually, add the repository variable `PRODUCTION_DEPLOY_ENABLED=1`. Until then, successful `main` CI intentionally skips automatic production deployment; protected manual deployments remain available.

## 6. First deployment

From a credentialed shell, validate the repository first:

```bash
pnpm install --frozen-lockfile
pnpm cf-typegen:check
pnpm check
pnpm worker:size
```

Then deploy one environment in order:

```bash
export APP_BASE_URL=https://exact-web-origin.example
export R2_ACCOUNT_ID=your-cloudflare-account-id
export EMAIL_FROM=events@your-verified-domain.example # production only
pnpm db:migrate
pnpm deploy:web:preview       # or deploy:web:production
pnpm deploy:jobs:preview      # or deploy:jobs:production
bash scripts/post-deploy-smoke.sh "$APP_BASE_URL"
```

The normal path after setup is `.github/workflows/deploy.yml`: once `PRODUCTION_DEPLOY_ENABLED=1`, successful CI on `main` deploys production, while manual runs can target preview or production. Web always deploys before jobs.

## 7. Still required after provisioning

A successful deploy is not the full hackathon infrastructure proof. Record the real Neon health response, R2 ISR and browser upload/CORS probes, jobs tail output, Workers CPU observations, and Resend SPF/DKIM/DMARC plus Gmail/Outlook delivery evidence in `DECISIONS.md`.
