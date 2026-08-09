# Openboard

Openboard is a conference program workspace: a public call for speakers, abstract review and
decisions, a speaker portal with tasks and file uploads, scheduling with conflict detection,
transactional communications, and public schedule/gallery pages with embeddable variants.

- **Deployed preview:** <https://sb-web-preview.yi-ding.workers.dev>
- **Judge's walkthrough:** [`docs/demo-script.md`](docs/demo-script.md)
- **Public API:** [`docs/api.md`](docs/api.md)
- **What is and is not finished:** [Honest status](#honest-status), below, and [`plan/status.md`](plan/status.md)

## Honest status

The repository is mid-build against [`PLAN.md`](PLAN.md), and this section is deliberately the
first thing you read. `plan/status.md` is the live evidence ledger; a claim below appears only if
something was actually demonstrated.

**Proven on the deployed preview:** the Worker itself, `/api/health` with a real Neon round-trip,
the public schedule and public API probes, and a jobs cron tick reaching the web Worker. The
deployed bundle measures within the Workers Free budget.

**Not yet proven anywhere:** email delivery through Resend (nothing about deliverability is
demonstrated), a deployed authentication round-trip, and a deployed submission through the server
pipeline. Large parts of the admin and portal UI currently render from a typed browser demo
adapter rather than from the database — that adapter exists so the surfaces could be built in
parallel, and it is being replaced surface by surface.

**Known gaps with evidence:**

- `/e/<slug>/schedule` is served uncached (`private, no-cache, no-store`) rather than with
  `s-maxage=60`. `scripts/post-deploy-smoke.sh` asserts the intended header and currently fails on it.
- The six Playwright specs exist and run, with every step still skipped pending its feature.
- Airtable export and the keyed half of the public API are deferred by the plan's own cut lines.

## Setup from a clean clone

```bash
pnpm install
cp .dev.vars.example .dev.vars     # then fill in DATABASE_URL and SESSION_SECRET at minimum
pnpm db:migrate                    # applies drizzle/ to whatever DATABASE_URL points at
pnpm seed                          # loads the demo world; --wipe to reset first
pnpm dev                           # http://localhost:3000
```

Then create the first organizer and reviewer accounts:

```bash
BOOTSTRAP_EVENT_ID=<event uuid> \
BOOTSTRAP_ADMIN_PASSWORD=<12+ chars> \
BOOTSTRAP_REVIEWER_PASSWORD=<12+ chars> \
pnpm admin:bootstrap
```

See [`docs/admin-bootstrap.md`](docs/admin-bootstrap.md) for the full flow and
[`docs/provisioning.md`](docs/provisioning.md) before connecting Neon, R2, Resend or Airtable.

Without credentials the app still starts: open `/` and choose **Open demo** for the browser-only
demo workspace, where changes persist in local storage.

## Validation

```bash
pnpm check              # typecheck, lint, invariants, tests, Next build, Worker build
pnpm test               # vitest: unit + PGlite integration
pnpm e2e                # Playwright; set E2E_BASE_URL to a deployed preview to un-skip
pnpm worker:size        # the compressed Workers Free budget check
pnpm cf-typegen:check   # generated bindings match wrangler.jsonc
bash scripts/post-deploy-smoke.sh <baseUrl> [--production] [--strict]
pnpm exec tsx scripts/load-test.ts <baseUrl> --form <formId> --slug <eventSlug>
```

## Deploying

```bash
pnpm deploy:web:preview     # OpenNext build + wrangler deploy, preview environment
pnpm deploy:jobs:preview
pnpm deploy:web:production  # gated on the production GitHub environment
```

`.github/workflows/ci.yml` runs the validation set on every PR.
`.github/workflows/deploy.yml` applies migrations, deploys the web and jobs Workers, and runs the
post-deploy smoke through protected GitHub environments.

## Architecture

Two deployables, one repository:

- **`sb-web`** — Next.js 15 on Cloudflare Workers through OpenNext. Owns every binding: the
  database, sessions, R2 presigning, Resend, ICS and Airtable configuration.
- **`workers/jobs`** — an isolated cron dispatcher with no application imports. It receives only
  `APP_BASE_URL` and its environment's `CRON_SECRET`, and calls back into the web Worker.

Inside `src`:

- `src/app` — thin App Router surfaces; route handlers compose features, they do not contain logic.
- `src/features/*` — vertical slices (events, forms, submissions, portal, agenda, comms, dashboard).
  Cross-feature communication happens only through `src/shared/contracts`, a feature's `index.ts`
  barrel, or the database schema.
- `src/shared/contracts` — the single source for cross-feature shapes, enums, branded ids, error
  codes and idempotency-key recipes. Frozen at CP1: changes require an architect-labeled PR.
- `src/shared/lib` — the pure halves that must have exactly one implementation: the condition
  evaluator, the snapshot compiler, the six-function timezone API, and the two sanitizer profiles.
- `src/shared/server` — server-only helpers, including the one module allowed to touch R2.
- `drizzle/` — the PostgreSQL schema, triggers and reporting views. Additive-only after the
  big-bang initial migration; `drizzle-kit push` is banned.
- `scripts/seed/` — the demo world, split per feature so it is never a merge hotspot.
- `plan/` — the authoritative module work orders, the execution schedule and the status ledger.

Several invariants are enforced by CI greps rather than by review: no `dangerouslySetInnerHTML`
outside the one rich-text view, no `process.env` outside `env.ts`, no date library outside
`time.ts`, no Resend outside the dispatcher, and no direct R2 access outside `shared/server/r2.ts`.

## License

MIT — see [`LICENSE`](LICENSE).
