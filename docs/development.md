# Developing and deploying Openboard

This page holds the engineering-facing material: current status, the capability map,
architecture, local setup, testing, and deployment. If you are an event organizer looking for
what Openboard does and how to use it, start with the [README](../README.md).

## Status

- **CI** (`.github/workflows/ci.yml`) runs the credential-free validation set on every PR:
  typecheck, lint, architecture and schema drift checks, invariant checks, the full Vitest suite
  (2,384 cases across two shards as of 2026-08-13), the Next.js build, and the Worker artifact
  gates.
- **Deploys run through GitHub Actions** (`.github/workflows/deploy.yml`): a merge to `main`
  deploys the preview environment automatically once CI passes — migration → web → jobs → strict
  post-deploy smoke — and production deploys run through the same workflow behind a protected
  GitHub environment. `scripts/deploy-cloudflare.sh` remains available for a manual deploy from a
  workstation; it validates the exact origin and the remote secret inventory before it builds.
- Admin/organizer authentication uses Better Auth in every environment (revocable sessions,
  email/password, and optional Google sign-in). Preview uses the explicit
  `EMAIL_FALLBACK_UI` delivery-demo affordance. Production validation refuses that affordance
  and `EMAIL_MODE=log`.
- The billing provider is a scaffold behind `BILLING_MODE=disabled`, which hides its link and
  returns 404 from the page, internal endpoints, and webhook. `BILLING_MODE=scaffold` is accepted
  only for local seam tests.
- Snapshot counts (re-run the commands in **Testing** for current numbers): 37 migrations in
  [`drizzle/`](../drizzle), 13 Playwright specs in [`e2e/`](../e2e), and a Worker bundle inside
  the 3 MiB Cloudflare Workers Free ceiling, enforced by `pnpm worker:size`.

## What's inside

| Area | Capability |
|---|---|
| Call for speakers | Six-step form builder, 8 field types, visibility/routing rules, immutable per-save snapshots, public 5-step CFP wizard with OTP, server-persisted drafts, deadline/limit enforcement, edit-until-close |
| Review | Multi-round evaluation plans, typed criteria, explicit reviewer assignments, blind review, recusal, reviewer provisioning/reminders, a scoring queue against the pinned submission snapshot |
| Speaker portal | Magic-link/OTP login, profile + headshot upload, tasks (manual/form/file), submissions with status, admin impersonation |
| Communications | 8 editable templates, a transactional outbox, reminder ladder, ICS invite/cancel with Google/Outlook deeplinks, bounce/complaint webhook, suppression + `List-Unsubscribe` |
| Agenda | Session CRUD, drag-and-drop day grid, pure conflict detection (room/speaker/track), list/day/week/track/room views, assisted conflict-safe placement |
| Public surfaces | Sessions, agenda, schedule itinerary with ICS export, speakers list, speaker gallery — each with a matching configurable `/embed/*` variant |
| Dashboards | Aggregated server endpoint over SQL reporting views, an attention-first queue, phase-aware ordering |
| Commercial layer | Organizations/tenancy, user management + invitations + audit log, Better Auth (email/password + Google), self-serve onboarding, GDPR export/erasure/retention, a billing scaffold, org-level speaker CRM (directory, segments, pipeline, merge) |
| Experience layer | Slide-over detail panels with keyboard next/prev, a shared bulk-action bar, a command palette, speaker "I'm speaking!" share moments, public schedule liveness |

## Architecture

Two Cloudflare Workers, one Next.js repository:

- **`sb-web`** — Next.js 15 (App Router) deployed via OpenNext. Owns the web application's bindings: Neon
  Postgres, sessions, R2 presigning, Resend, ICS, Better Auth. (The jobs Worker below holds the
  only two bindings outside it.)
- **`workers/jobs`** — a dumb cron dispatcher with no application imports. It holds only
  `APP_BASE_URL` and a `CRON_SECRET`, and calls back into `sb-web`'s `/api/jobs/*` routes on a
  minute-modulo schedule (outbox drain, reminders, cleanup).

Inside `src`:

- `src/app` — thin route handlers; logic lives in features.
- `src/features/*` — vertical slices (events, forms, submissions, portal, evaluation, comms,
  agenda, public, dashboard, organizations, billing, crm, data-lifecycle, onboarding, shell).
  Features talk to each other only through `src/shared/contracts` or a feature's `index.ts`.
- `src/shared/contracts` — the single source for cross-feature types, enums, branded ids, and
  error codes.
- `src/shared/lib` — the one condition evaluator, snapshot compiler, timezone API, and sanitizer
  profiles — each has exactly one implementation, enforced by CI greps.
- `drizzle/` — Postgres schema, views, and triggers. Additive-only after the initial migration.
- Every event-scoped table carries a composite foreign key back to `(event_id)`, so a
  cross-tenant or cross-event row is a database-level rejection, not an application check;
  organization-scoped tables extend the same pattern one level up.
- Outbound email never writes to Resend inline: a domain event enqueues a row in the
  transactional outbox, and the cron-driven dispatcher is the one place that calls Resend.

## Getting started

Prerequisites: Node.js 22 (pinned in `.node-version`), pnpm (`packageManager` pins
`pnpm@11.21.0`), and — for the database-backed path — a Neon Postgres URL.

```bash
pnpm install
cp .dev.vars.example .dev.vars     # fill in DATABASE_URL / DATABASE_URL_DIRECT and SESSION_SECRET
pnpm db:migrate                    # applies drizzle/ to whatever DATABASE_URL_DIRECT points at
pnpm seed                          # loads the sample event; pass --wipe to reset first
pnpm dev                           # http://localhost:3000
```

Then create the first admin/reviewer accounts with the one-shot bootstrap. It creates or updates
the organizer and reviewer identities, writes each credential directly to Better Auth's
`admin_accounts` table, and assigns real event memberships:

```bash
export DATABASE_URL='postgresql://...'      # Neon-protocol URL; the script opens a Pool transaction
# The seeded demo event's id is deterministic; print it with: pnpm smoke:fixture-ids
export BOOTSTRAP_EVENT_ID='9677e5d3-ccfc-5270-9b22-e551f8b4c57d'
export BOOTSTRAP_ADMIN_PASSWORD='<12+ chars>'
export BOOTSTRAP_REVIEWER_PASSWORD='<12+ chars>'
pnpm admin:bootstrap
```

Both passwords are required and must be at least 12 characters. The command is idempotent for
`organizer@openboard.dev` and `reviewer@openboard.dev`: re-running it rotates their password
hashes and restores the owner/reviewer roles for the selected event. Passwords are read only from
the environment and are never printed or committed.

See [`docs/provisioning.md`](provisioning.md) (Neon/R2/Resend/Cloudflare setup) for the full
infrastructure flow.

**A database is required.** Openboard has one runtime path — every screen reads and writes
Postgres. Point `.dev.vars` at a Neon branch and run `pnpm seed` — that is the local walkthrough
environment, and [`docs/demo-script.md`](demo-script.md) walks it. The runtime connects through
the Neon serverless driver (`@neondatabase/serverless` over HTTP), so `DATABASE_URL` must point
at a Neon-protocol endpoint; a plain local Postgres socket does not work out of the box.

## Testing

```bash
pnpm typecheck          # tsc --noEmit
pnpm lint                # eslint --max-warnings=0
pnpm architecture:check  # AST feature-boundary and cycle ratchet
pnpm schema:check        # full migration journal vs Drizzle metadata and SQL-only ledger
pnpm source:check        # AST imports, environment access, JSX, route roles, and storage seams
pnpm invariants          # source AST plus literal configuration and CSS declaration checks
pnpm audit:prod          # fail on any known production-dependency advisory
pnpm test                # vitest: unit + PGlite integration suites
pnpm e2e                 # Playwright — also set E2E_BASE_URL and the two E2E password variables
pnpm check               # typecheck + lint + invariants + test + next build + worker build
pnpm worker:size         # Workers Free compressed-size gate
pnpm smoke:worker        # boots the built OpenNext artifact under local workerd
pnpm cf-typegen:check    # generated Cloudflare bindings match wrangler.jsonc
pnpm release:check       # full credential-free CI and artifact gate
bash scripts/post-deploy-smoke.sh <baseUrl> [--production] [--strict]
```

The pinned Next/OpenNext/Wrangler matrix, custom chunking removal gate, artifact
probe coverage, and dependency-upgrade canary procedure are documented in the
[Worker artifact compatibility contract](worker-artifact-contract.md).

The 13 specs in [`e2e/`](../e2e) (`cfp-submit`, `abstracts-decide`, `admin-setup`,
`agenda-schedule`, `portal-tasks`, `public-embeds`, `public-widgets-parity`,
`rendered-ui-polish`, `responsive-action-groups`, `review-operations`, `self-service-onboarding`,
`speaker-content-ops`, `typography-hierarchy`) are written to run against
a deployed target plus the `sb-test` Neon branch, not against `localhost` fixtures — set
`E2E_BASE_URL`, `NEON_TEST_URL`, `E2E_ADMIN_PASSWORD`, and `E2E_REVIEWER_PASSWORD` first. The
Playwright global setup wipes and seeds the test database, then recreates the seeded Better Auth
credentials with those two 12+-character passwords via `pnpm admin:bootstrap`. The deploy
workflow runs the self-service journey against the freshly
deployed preview on every merge to `main`.

## Deploying

The paved road is the `Deploy` GitHub Actions workflow: a merge to `main` deploys the preview
environment automatically once CI passes (migration → web → jobs → strict smoke → the
self-service e2e journey). A manual deploy from a workstation goes through
`scripts/deploy-cloudflare.sh`:

```bash
export APP_BASE_URL=https://sb-web-preview.yi-ding.workers.dev   # exact deployed origin; the script refuses anything else
export R2_ACCOUNT_ID=<cloudflare account id>
pnpm deploy:web:preview      # OpenNext build + wrangler deploy, preview environment
pnpm deploy:jobs:preview

export APP_BASE_URL=https://openboard.events
pnpm deploy:web:production
pnpm deploy:jobs:production
```

The protected `production` GitHub environment gates the `Deploy` Actions workflow only — these
local commands bypass that approval gate. The wrapper still validates the exact origin and checks
the remote Worker secret inventory before it builds or deploys, except for the explicit
`ALLOW_MISSING_DEPLOY_SECRETS=1` first-web-Worker bootstrap. That override first proves through
Cloudflare's API that the target Worker does not exist and is rejected for jobs or any existing
Worker; treat production invocations accordingly.

`.github/workflows/ci.yml` runs the credential-free validation set on every PR.
`.github/workflows/deploy.yml` runs migration → web → jobs → smoke through protected GitHub
environments. A merge to `main` deploys `preview` automatically once its CI run succeeds.
`production` is a manual `workflow_dispatch` that always replays the same commit through a
second, sequential preview leg before the protected production leg, so it cannot bypass the
preview smoke and browser canary. Full provisioning steps
(Neon, R2, Resend, Cloudflare, GitHub environments) are in
[`docs/provisioning.md`](provisioning.md); operational runbooks (backup/restore, rollback,
Neon PITR rehearsal, R2 lifecycle, alerting) are in [`docs/runbooks/`](runbooks).
