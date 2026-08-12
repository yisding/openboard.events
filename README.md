# Openboard

Openboard is an open-source event and speaker-management platform for conferences: a public
call for speakers with conditional logic and routing, multi-round submission review, a speaker
portal, automated transactional communications, a drag-and-drop agenda with conflict detection,
public schedule/speaker/embed pages, and dashboards — plus a commercial layer (organizations,
user management, Better Auth incl. Google sign-in, a billing scaffold, GDPR tooling) and an
experience layer of dashboards, flow-through lists, and a command palette on top.

- **Deployed preview (seeded demo world):** <https://sb-web-preview.yi-ding.workers.dev>
- **Judge/reviewer walkthrough:** [`docs/demo-script.md`](docs/demo-script.md)
- **Public API reference:** [`docs/api.md`](docs/api.md)
- **Build history and current status:** [`plan/`](plan/), starting with
  [`plan/status.md`](plan/status.md) (the live evidence ledger) and
  [`plan/product-roadmap.md`](plan/product-roadmap.md)

## Honest status

This project was built against an aggressive hackathon deadline and then continued past it toward
a sellable product. The codebase is broad and largely server-backed, but **not every acceptance
criterion has been demonstrated against a deployed environment**, and the ledger in
[`plan/status.md`](plan/status.md) is the source of truth — read it before trusting a claim below.

**What is proven against the deployed preview:** a real Neon-backed health check; admin sign-in
through Better Auth with server-side session revocation (Google OAuth is wired and its
callback is accepted by Google — verified to the sign-in redirect, per the evidence file §11.1;
the interactive login itself is a demo-time step); portal OTP login; a CFP submission stored with routing applied; email delivered to a
real Gmail inbox from a verified sending domain (SPF/DKIM/DMARC aligned); accept → notify → a real
Resend send; reviewer scoring with a rating that matches a hand-computed average; a browser-driven
R2 file upload (presign → PUT → finalize); all five public/embed surfaces (sessions, agenda,
itinerary with ICS export, speakers list, speaker gallery); an assisted agenda-placement apply;
a deployed application-layer sign-in throttle (paced attempts return `429` after five tries); and
a Worker bundle inside the Cloudflare Workers Free budget.

**What is not yet proven anywhere:** a green run of the `Deploy` GitHub Actions workflow (every
deploy so far is a laptop operation via `scripts/deploy-cloudflare.sh`); production (`sb-prod`) is
provisioned — database migrated through the full journal, both workers deployed with secrets —
but its first healthy post-deploy smoke is still pending (this post-dates the ledger's rev. 12
snapshot; the recorded proof is [`docs/evidence/rev13-deployed-run.md`](docs/evidence/rev13-deployed-run.md) §11.2,
which the ledger's next revision will absorb); an Outlook delivery probe; and full end-to-end passes of the review
reminders, speaker-roster, and content-operations e2e specs (each has failed on a real but narrow
gap — see `plan/status.md` §3 for the specifics rather than treating the surface as untested).
`TEST_AUTH` remains enabled on the preview and must be disabled before any non-demo deployment.

**Numbers, pulled from the tree, not memory:** 17 migrations in [`drizzle/`](drizzle), 9
Playwright specs in [`e2e/`](e2e), and (last recorded, `plan/status.md` §2h) 1299 passing Vitest
cases across 153 files with a merged-tree Worker size of ~2.3 MiB gzip against the 3 MiB Free
ceiling. Nothing here is a target — it's a snapshot; re-run the commands in **Testing** below for
the current count.

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

The full feature-to-module mapping lives in [`PLAN.md`](PLAN.md) §1's product table.

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

Prerequisites: Node.js, pnpm (`packageManager` pins `pnpm@11.8.0`), and — for the database-backed
path — a Postgres URL (Neon or otherwise).

```bash
pnpm install
cp .dev.vars.example .dev.vars     # fill in DATABASE_URL / DATABASE_URL_DIRECT and SESSION_SECRET
pnpm db:migrate                    # applies drizzle/ to whatever DATABASE_URL_DIRECT points at
pnpm seed                          # loads the demo world; pass --wipe to reset first
pnpm dev                           # http://localhost:3000
```

Then create the first admin/reviewer accounts:

```bash
BOOTSTRAP_EVENT_ID=<event uuid> \
BOOTSTRAP_ADMIN_PASSWORD=<12+ chars> \
BOOTSTRAP_REVIEWER_PASSWORD=<12+ chars> \
pnpm admin:bootstrap
```

See [`docs/admin-bootstrap.md`](docs/admin-bootstrap.md) and
[`docs/provisioning.md`](docs/provisioning.md) (Neon/R2/Resend/Cloudflare setup) for the full
flow.

**No credentials? No database?** The app still starts. Open `/` and choose **Open demo** for a
credential-free, database-free local demo mode — every screen renders from a typed in-browser
fixture set with changes persisted to `localStorage`, and **Reset demo** on `/events` restores the
seed.

## Testing

```bash
pnpm typecheck          # tsc --noEmit
pnpm lint                # eslint --max-warnings=0
pnpm invariants          # CI greps: single sanitizer/evaluator/dispatcher, no stray process.env, etc.
pnpm test                # vitest: unit + PGlite integration suites
pnpm e2e                 # Playwright — set E2E_BASE_URL to a deployed target to run against it
pnpm check               # typecheck + lint + invariants + test + next build + worker build
pnpm worker:size         # Workers Free compressed-size gate
pnpm cf-typegen:check    # generated Cloudflare bindings match wrangler.jsonc
bash scripts/post-deploy-smoke.sh <baseUrl> [--production] [--strict]
```

The nine specs in [`e2e/`](e2e) (`cfp-submit`, `abstracts-decide`, `admin-setup`,
`agenda-schedule`, `portal-tasks`, `public-embeds`, `public-widgets-parity`,
`review-operations`, `speaker-content-ops`) are written to run against a deployed target plus the
`sb-test` Neon branch, not against `localhost` fixtures — set `E2E_BASE_URL` and `NEON_TEST_URL`
first. `plan/status.md` §3 and [`docs/evidence/rev13-deployed-run.md`](docs/evidence/rev13-deployed-run.md)
record the current pass/fail state and the specific, narrow gaps behind the remaining failures.

## Deploying

Deploys are currently a laptop operation via `scripts/deploy-cloudflare.sh`, not a green
`Deploy` GitHub Actions run (see Honest status):

```bash
export APP_BASE_URL=https://sb-web-preview.yi-ding.workers.dev   # exact deployed origin; the script refuses anything else
export R2_ACCOUNT_ID=<cloudflare account id>
pnpm deploy:web:preview      # OpenNext build + wrangler deploy, preview environment
pnpm deploy:jobs:preview

export APP_BASE_URL=https://sb-web.yi-ding.workers.dev
pnpm deploy:web:production
pnpm deploy:jobs:production
```

The protected `production` GitHub environment gates the `Deploy` Actions workflow only — these
local commands bypass that gate entirely and are restrained by nothing but the script's
argument checks. Treat production invocations accordingly.

`.github/workflows/ci.yml` runs the credential-free validation set on every PR.
`.github/workflows/deploy.yml` runs migration → web → jobs → smoke through protected GitHub
environments, but has not yet completed a non-`skipped` run end to end. A merge to `main`
deploys `preview` automatically once its CI run succeeds; `production` is a manual
`workflow_dispatch` until the repository variable `PRODUCTION_DEPLOY_ENABLED=1` adds it as a
second, sequential leg behind a preview that passed its own smoke test. Full provisioning steps
(Neon, R2, Resend, Cloudflare, GitHub environments) are in
[`docs/provisioning.md`](docs/provisioning.md); operational runbooks (backup/restore, rollback,
Neon PITR rehearsal, R2 lifecycle, alerting) are in [`docs/runbooks/`](docs/runbooks).

## License

MIT — see [`LICENSE`](LICENSE).

Copyright (c) 2026 Openboard contributors.
