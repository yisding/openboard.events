# Provisioning Cloudflare and Neon

How to take the repository from configuration-ready to a deployed preview and production
environment — written for standing up a new environment (or re-provisioning this one) rather
than as a log of the first bring-up. Cloudflare Git integration stays disabled: the protected
GitHub Actions workflow owns the required migration → web → jobs → smoke order.

Two hygiene items from the original bring-up remain open and are tracked in
[#633](https://github.com/yisding/openboard.events/issues/633): deleting the retired
`CRON_SECRET` from every Worker's remote secret inventory, and moving `CLOUDFLARE_API_TOKEN`
from repository scope to the two protected GitHub environments. The R2 lifecycle rules in
section 4 are also still unprovisioned.

## 0. Validate the checkout

Run the credential-free validation in the same order as CI:

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

## 1. The environment map

The exact origins are encoded in `scripts/deploy-cloudflare.sh` — a preview/production mismatch
fails before either Worker can be changed. Keep each origin HTTPS only, with no path and no
trailing slash: preview is `https://sb-web-preview.yi-ding.workers.dev` (the account's real
`workers.dev` subdomain), production is `https://openboard.events`.

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

Each environment needs its own independent `SESSION_SECRET`, `UNSUBSCRIBE_SECRET`, and
`SPEAKER_SHARE_SECRET`, each at least 32 random characters. They sign different payloads and
must never reuse one another or be shared between preview and production. `RESEND_WEBHOOK_SECRET`
is different: create the webhook in Resend per environment and copy its provider-issued signing
secret — never generate or substitute this value locally, and never reuse the preview webhook in
production.

Store the values in a password manager; do not commit them or paste them into issue or PR
comments. One suitable generator:

```bash
openssl rand -base64 48
```

## 3. Provision Neon

Create one Neon project with `sb-dev`, `sb-test`, and `sb-prod` as isolated databases/branches
(or separate projects for stronger isolation). For each environment save two URLs: the pooled
URL (hostname contains `-pooler`) becomes the web Worker's `DATABASE_URL` secret; the direct URL
becomes local or GitHub `DATABASE_URL_DIRECT` and is used only for migrations.

Apply committed migrations to a disposable branch first, then to `sb-dev` and `sb-test`.
`sb-prod` migration belongs to the guarded production deployment step — confirm no destructive
test or reset command points at it.

Run a migration by exporting the matching direct URL in a credentialed shell:

```bash
export DATABASE_URL_DIRECT='postgresql://...direct-neon-host...'
pnpm db:migrate
```

Never put `DATABASE_URL_DIRECT` on a Worker. Never use a pooled URL for migrations.

`pnpm db:migrate` first verifies every applied migration's content hash and order against the
checkout. The repository once carried future-dated `when` values, so an existing database can
have a future high-water mark even though the committed journal is now repaired. The wrapper
leaves that database journal untouched and gives only pending entries in an ephemeral journal a
timestamp above the existing high-water mark before invoking Drizzle. This both lets new
migrations run and keeps older rollback checkouts from mistaking applied DDL for pending work. A
missing, extra, or changed hash fails closed; the ephemeral files live under `~/Code` and are
removed after the command.

## 4. Provision Cloudflare and R2

- Confirm the Cloudflare account ID and save it as `R2_ACCOUNT_ID` for runtime use.
- Create the `sb-files-preview` and `sb-files` buckets; `sb-files-dev` is optional, for real
  local presign/CORS testing (normal local work can use Wrangler-local R2).
- Create separate Object Read & Write S3 credentials scoped to each bucket, and save each
  access-key ID and secret when Cloudflare displays them. Never reuse production credentials in
  preview.
- Configure each bucket's CORS with only that environment's exact origin:

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

- Provision the R2 lifecycle rule(s) described in
  [`runbooks/r2-lifecycle.md`](./runbooks/r2-lifecycle.md) on both buckets — defense in depth
  behind the app-level orphan-staging sweep (`cleanupOrphans`, already running on the daily
  cleanup cron), not a substitute for it. That doc also records a real key-scheme finding that
  limits what a single static rule can cover today. **Still unprovisioned.**

## 5. Create the Cloudflare automation tokens

- Create a least-privilege Cloudflare API token that can deploy Workers and use the required R2
  bindings in this account; save it as `CLOUDFLARE_API_TOKEN`. Do not use the global API key.
  It belongs in both protected GitHub environments, not at repository scope (see
  [#633](https://github.com/yisding/openboard.events/issues/633)).
- Save the account ID as `CLOUDFLARE_ACCOUNT_ID`.
- Create a separate API token scoped only to the `openboard.events` zone with
  **Email Security DMARC Reports Read** and **Write**. Do not add Zone Read: the workflow uses an
  explicit zone ID. Save it only as the production-environment secret
  `CLOUDFLARE_DMARC_API_TOKEN`; never reuse the deployment token for DMARC operations.
- Confirm Cloudflare's repository/Git integration is disabled.

## 6. Bootstrap an environment

Finish sections 0–5 and migrate the environment's database before starting. The commands below
show preview; production is the same with the production values and `--env production`.

Export the exact values in the credentialed shell:

```bash
export APP_BASE_URL='https://sb-web-preview.yi-ding.workers.dev'
export R2_ACCOUNT_ID='your-cloudflare-account-id'
```

Bootstrap the web Worker. A temporary unhealthy response is expected until its secrets exist:

```bash
ALLOW_MISSING_DEPLOY_SECRETS=1 pnpm deploy:web:preview
```

Complete the required secret inventory on the web Worker, then redeploy it
(`pnpm deploy:web:preview`):

| Secret | Value |
|---|---|
| `DATABASE_URL` | that environment's pooled Neon URL |
| `SESSION_SECRET` | per-environment session secret |
| `UNSUBSCRIBE_SECRET` | per-environment unsubscribe-token secret |
| `RESEND_WEBHOOK_SECRET` | provider-issued Resend webhook signing secret |
| `SPEAKER_SHARE_SECRET` | per-environment speaker-share token secret |
| `R2_ACCESS_KEY_ID` | that bucket's credential |
| `R2_SECRET_ACCESS_KEY` | that bucket's credential |
| `RESEND_API_KEY` | domain-scoped sending key (preview runs `EMAIL_MODE=send` behind a one-address allowlist) |
| `GOOGLE_CLIENT_ID` | Google OAuth web-client identifier |
| `GOOGLE_CLIENT_SECRET` | Google OAuth web-client secret |

```bash
pnpm exec wrangler secret put DATABASE_URL --env preview
# …repeat for each name above
```

Create the jobs Worker only after the matching web Worker exists:

```bash
pnpm deploy:jobs:preview
```

Confirm the jobs Worker has the `WEB_JOBS` Service Binding to the matching
`#JobsEntrypoint`. Its only application variable is `AIRTABLE_CRON` (plain `"0"` or `"1"`, not a
secret — see `workers/jobs/wrangler.jsonc`), and it has no secrets at all; do not copy database,
session, R2, Resend, or Airtable credentials to it.

Run the smoke check. Without the `SMOKE_*` fixture ids the dashboard, submit-form, and headshot
checks skip instead of running; `--strict` turns any skip into a failure, which is how the
deploy workflow runs it:

```bash
while IFS= read -r line; do export "${line?}"; done < <(pnpm --silent smoke:fixture-ids)
bash scripts/post-deploy-smoke.sh "$APP_BASE_URL" --strict
```

Inspect Workers logs for successful scheduled-job ticks over RPC. If the retired `CRON_SECRET`
remains in Cloudflare's remote secret inventory, delete it from both Workers in every
provisioned environment ([#633](https://github.com/yisding/openboard.events/issues/633)):

```bash
for target_env in preview production; do
  pnpm exec wrangler secret delete CRON_SECRET --env "$target_env"
  pnpm exec wrangler secret delete CRON_SECRET \
    --config workers/jobs/wrangler.jsonc --env "$target_env"
done
```

Seed the non-production databases — `APP_ENV=local DATABASE_URL=<sb-dev pooled URL> pnpm seed`
and `APP_ENV=preview DATABASE_URL=<sb-test pooled URL> pnpm seed` (add `--wipe` to reset
first). The seed refuses an unclassified `APP_ENV` and refuses any database whose own
`app.environment` marker disagrees. Then create the password-backed organizer and reviewer
accounts with `pnpm admin:bootstrap` (credentials held outside the repository).

Subsequent jobs deployments use `pnpm deploy:jobs:<env>`. The account-scoped `WEB_JOBS`
Service Binding is the only scheduled transport, and matching web/jobs versions are deployed in
that order.

## 7. Configure protected GitHub environments

GitHub environments are named exactly `preview` and `production`; `production` requires a
reviewer and is restricted to `main`. Validation CI is credential-free — runtime application
secrets live in Cloudflare; GitHub stores only the credentials and direct database URL the
deployment workflow needs.

Environment secrets:

| GitHub environment secret | Preview value | Production value |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | scoped Cloudflare token | scoped Cloudflare token |
| `CLOUDFLARE_DMARC_API_TOKEN` | unset | zone-scoped DMARC Read/Write token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | Cloudflare account ID |
| `DATABASE_URL_DIRECT` | `sb-test` direct Neon URL | `sb-prod` direct Neon URL |
| `E2E_RESEND_API_KEY` | optional preview-only, read-capable Resend key for the sent-email delivery probe | unset |

The preview E2E job derives `NEON_TEST_URL` from the `DATABASE_URL_DIRECT` secret
(`.github/workflows/deploy.yml`); do not store a second copy.

Environment variables:

| GitHub environment variable | Preview | Production |
|---|---|---|
| `APP_BASE_URL` | exact preview origin | exact production origin |
| `CLOUDFLARE_ZONE_ID` | unset | `openboard.events` zone ID |
| `R2_ACCOUNT_ID` | Cloudflare account ID | Cloudflare account ID |
| `E2E_SIGNUP_EMAIL` | optional dedicated address included in preview's exact email allowlist | unset |

`E2E_BASE_URL` is derived from `APP_BASE_URL` for the preview E2E job and defaults to the
preview origin in `playwright.config.ts` — do not add it. `EMAIL_FROM` and `EMAIL_REPLY_TO`
also need no entries: the stable sender and monitored reply mailbox live in `wrangler.jsonc`'s
vars for both environments (the From address contains angle brackets, which cannot survive
`--var`, so `scripts/deploy-cloudflare.sh` only verifies both values are present in config
before a production deploy). Leave `EMAIL_ALLOWLIST` unset too — the one-address preview
allowlist is committed in `wrangler.jsonc`, and a GitHub value silently overrides it. Leave the
`SMOKE_*` variables unset: the deploy workflow fills each unset one from
`pnpm smoke:fixture-ids`; set one only to deliberately override a fixture.

Every preview deploy runs the complete signup → activation → organization → event → public CFP
→ first proposal browser journey. With no E2E mailbox credentials, it uses the preview-only
activation and OTP fallback plus the reserved `e2e-self-service@openboard.invalid` address, so
the product journey remains a credential-free deployment gate. Configure both optional E2E
values to make the same journey additionally prove delivery through Resend; configuring only
one deliberately falls back instead of partially exercising the provider path.

Production promotion stays manual. A successful `main` CI run always deploys `preview` only,
leaving time for its scheduled uptime checks before protected promotion. The `preview`
environment must have no required reviewer, or every merge queues an approval instead of
deploying. An automatic deployment for a superseded `main` SHA reports that it was skipped
before checkout, migration, or deployment — do not remove this freshness gate or change
deployment concurrency to cancel an in-progress migration/deploy.

## 8. Resend

The sending identity is a dedicated verified subdomain, `mail.openboard.events`, with SPF and
DKIM published and aligned, DMARC aggregate reporting enabled per
[`docs/runbooks/dmarc.md`](runbooks/dmarc.md), and full quarantine published at the exact
From-domain record (keep the runbook's aggregate-report and receiver gates before moving to
reject). One stable product sender on the authenticated domain:
`Openboard <hello@mail.openboard.events>`.

Resend Receiving is enabled on the same subdomain with the priority-10 inbound MX at
`inbound-smtp.us-east-1.amazonaws.com`, without changing Resend's independent bounce MX.
Deployed send mode requires `hello@mail.openboard.events` as `EMAIL_REPLY_TO` so From and
Reply-To keep one stable identity.

Each environment gets its own `RESEND_API_KEY` (domain-scoped). Before tightening DMARC
further, repeat the Gmail/Outlook authentication and placement probes; the recorded baselines
(Gmail Inbox, first Outlook `portal_login` in Junk with all authentication passing) live with
the delivery checks in `docs/manual-test-plans.md` MTP-12. Calendar REQUEST/reschedule/CANCEL
delivery still needs a hand-read Outlook placement baseline — see MTP-12's Known gaps.

## 9. Deploy production

- Confirm `sb-prod`, `sb-files`, production CORS, Resend, and GitHub production protection are
  ready.
- Bootstrap `sb-web`, then set its runtime secrets exactly as for preview, using the production
  values plus `RESEND_API_KEY`.
- Confirm production uses `EMAIL_MODE=send`, `EMAIL_FALLBACK_UI=0`, and no `EMAIL_ALLOWLIST`.
- Create `sb-jobs` after `sb-web`, and confirm its declared `WEB_JOBS` binding resolves to
  `sb-web#JobsEntrypoint`, its application secret inventory is empty, and `AIRTABLE_CRON` is
  `"1"` (the shipped default in `workers/jobs/wrangler.jsonc`; it is the scheduled-sync kill
  switch — see `docs/airtable.md`).
- After preview has passed at least one scheduled 15-minute uptime cycle, manually run the
  `Deploy` workflow for `production` and approve its protected environment gate. The workflow
  first replays the exact commit through preview; production cannot be selected alone.
- Confirm preview migration → web → jobs → smoke → browser canary succeeds, followed by the
  production migration → web → jobs → smoke leg, then the real production health response and
  jobs cron logs.
- Keep automatic production promotion disabled. Every release retains a preview soak and canary
  through the same protected manual dispatch.

Production web secrets are the same ten names as preview (section 6's table) with production
values. `pnpm deploy:preflight web|jobs preview|production` compares the required web names —
the ten in `WEB_DEPLOY_SECRET_NAMES` — with Cloudflare's secret names without reading any secret
value. The jobs Worker intentionally has no required secrets. Both the protected deploy workflow
and the local deploy wrapper run it before release. `ALLOW_MISSING_DEPLOY_SECRETS=1` exists only
for the first bootstrap of a Worker that does not exist yet; after that first deploy, provision
the complete inventory before deploying application code again.

`AIRTABLE_API_KEY` is deliberately **not** a deployed secret. Every real Airtable credential is
per-event: an organizer pastes their own personal access token into the event settings panel, and
it is sealed at rest in `airtable_connections` (`src/features/airtable/server/secret-payload.ts`)
— never a standing environment variable. `AIRTABLE_API_KEY` exists only as a local convenience for
`scripts/airtable-acceptance.ts`, and `src/shared/lib/env.ts` fails a deployed (`preview` or
`production`) parse closed if it is ever set there. `AIRTABLE_BASE_ID` does not exist at all for
the same reason — a single global base id in a multi-tenant product is a cross-tenant write
waiting to happen.

## 10. The self-serve demo event

Nothing here needs provisioning — the demo event is built at runtime, per organization, by the
product's own writers. This section exists because an operator will meet it in the logs, in the
billing numbers and in a support ticket, and should know what it is before they do.

**What it is.** One event per organization, flagged `events.is_demo`, created only by
`POST /api/internal/organizations/{organizationId}/demo` as ten idempotent phases, one request
each. Roughly 430 rows, under six seconds of wall clock in total. No other request in the product
can produce one: `is_demo` is not on any input schema and reaches the INSERT as a server-only
argument to `createEventIn`.

**What it costs.** Ten POSTs per organization, rate-limited to 40 per five minutes per
organization — sized for the loop plus a retry of every phase and a couple of resets, and for
nothing else. The tour's world-state poll is `GET /api/internal/events/{eventId}/tour`, one
indexed statement, limited to 400 per five minutes per event, and it only runs while the player
has an objective armed (2 s backing off to 10 s, suspended while the tab is hidden, hard stop
after ten minutes). At most one active tutorial per organizer, once.

**What it cannot do.**

- **Send mail.** Two independent barriers: every fabricated address is `@…demo.invalid`
  (RFC 2606, no DNS), and `buildContext` raises `SkipEmail("demo event — mail is never
  delivered")` on `events.is_demo` with no exceptions. Provisioning writes no `queued` outbox row,
  so the per-minute `outbox` cron finds nothing from it. The `reminders` cron is deliberately
  **not** filtered — the ladder genuinely fires for the demo's overdue task and every row it
  produces drains to `skipped`, which is what the tutorial shows the organizer in Chapter 5.
- **Consume a plan slot.** `countOrganizationEventsIn` filters `is_demo = false`, and neither the
  entitlement gate nor the usage counter is called. An organization at its cap can still build one.
- **Be indexed.** Demo sessions ship unpublished, its five embed configurations ship disabled, and
  once an organizer publishes them the public and embed routes answer `robots: noindex, nofollow`
  and carry a *"Sample event"* ribbon. The slug is per-organization and contains `-demo-`.
- **Become a real event.** There is no path that clears the flag; the hand-off copies vocabulary
  and one form's structure onto a *new* event instead.

**Operating it.**

| Need | Do this |
|---|---|
| Find an organization's demo | `SELECT id, slug, created_at FROM events WHERE organization_id = $1 AND is_demo` |
| Confirm a build finished | `SELECT provision_phase FROM event_demo_tour WHERE event_id = $1` — `ready` means done; anything else names the phase it stopped on |
| Rebuild a broken one | `POST …/demo {"mode":"reset"}`, then `{"mode":"provision"}` until `done`. It rebuilds at the same deterministic id |
| Unstick a half-built one the organizer wants to keep | `POST …/demo {"mode":"skip"}` — jumps the cursor to `ready` and leaves the world as far as it got |
| Remove one | `DELETE …/demo {"confirm":"DELETE"}`, owner only. `is_demo = true` is inside the DELETE's own predicate, so it is structurally incapable of removing a real event |
| See what it did on the owner's behalf | The organization audit log: `demo.provisioned`, `demo.reset`, `demo.deleted` |

**Residue after a delete.** R2 holds nothing at provision time (the demo ships with no headshots on
purpose); anything the organizer uploaded during the tour is swept by the existing `cleanup` cron.
`organization_usage_counters` was never incremented. The `demo_provisioned` and `tour_completed`
milestones are first-occurrence and permanent, and stay — the funnel event did happen.
