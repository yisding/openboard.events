# Openboard

Openboard is an end-to-end conference program workspace for calls for speakers, review, speaker onboarding, communications, scheduling, and public agendas.

## Local development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`, then choose **Open demo**. The seeded AI Engineer World’s Fair workspace is fully navigable, and interactive demo changes persist in local storage.

## Validation

```bash
pnpm check
pnpm cf-typegen:check
pnpm worker:size
```

The app targets Next.js 15 on Cloudflare Workers through OpenNext. Copy `.dev.vars.example` to `.dev.vars` when connecting Neon, R2, Resend, and Airtable.

## Architecture

- `src/app` contains thin App Router surfaces.
- `src/features` owns vertical product slices.
- `src/shared/contracts` is the single source for cross-feature shapes and enums.
- `src/shared/demo` is a typed persisted demo adapter; production server adapters can replace it without changing the UI contracts.
- `workers/jobs` is the isolated cron dispatcher.
- `plan/` contains the authoritative module work orders.

The initial experience runs without external credentials. Before connecting external services, follow [`docs/provisioning.md`](docs/provisioning.md). See `DECISIONS.md` for unresolved infrastructure checks and `PLAN.md` for the full implementation contract.

After migrating and creating the first event, use [`docs/admin-bootstrap.md`](docs/admin-bootstrap.md) to provision password-backed organizer and reviewer accounts.

## Demo and integration references

- `docs/demo-script.md` walks through the complete seeded organizer and speaker journey.
- `docs/api.md` documents public endpoints and the deliberately disabled private API surface.
- `drizzle/` contains the PostgreSQL schema, update triggers, and reporting views.
- `.github/workflows/ci.yml` runs generated-binding checks, types, invariants, tests, lint, Next/OpenNext builds, and the compressed Worker budget check.
- `.github/workflows/deploy.yml` applies Neon migrations, then deploys web, jobs, and smoke checks through protected GitHub environments.
