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
pnpm typecheck
pnpm invariants
pnpm test
pnpm build
pnpm build:worker
```

The app targets Next.js 15 on Cloudflare Workers through OpenNext. Copy `.dev.vars.example` to `.dev.vars` when connecting Neon, R2, Resend, and Airtable.

## Architecture

- `src/app` contains thin App Router surfaces.
- `src/features` owns vertical product slices.
- `src/shared/contracts` is the single source for cross-feature shapes and enums.
- `src/shared/demo` is a typed persisted demo adapter; production server adapters can replace it without changing the UI contracts.
- `workers/jobs` is the isolated cron dispatcher.
- `plan/` contains the authoritative module work orders.

The initial experience runs without external credentials. See `DECISIONS.md` for unresolved infrastructure checks and `PLAN.md` for the full implementation contract.

## Demo and integration references

- `docs/demo-script.md` walks through the complete seeded organizer and speaker journey.
- `docs/api.md` documents public, keyed, calendar, and cron endpoints.
- `drizzle/` contains the PostgreSQL schema, update triggers, and reporting views.
- `.github/workflows/ci.yml` runs types, invariants, tests, lint, and the production build.
