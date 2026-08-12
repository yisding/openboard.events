# Production-readiness audit — August 11, 2026

This is a current-state audit of `main` at `422b391`, run in America/Los_Angeles on August 11,
2026. It supplements the rev. 13 evidence ledger; it does not rewrite historical results.

## Live state

Both canonical origins passed `scripts/uptime-check.sh`:

| Environment | Deployed SHA | Database | Communications |
|---|---|---|---|
| production | `01fc390cf46521d11774b9c2a2090a5507f97dba` | PostgreSQL 18.4, healthy | 0 queued, 0 failed |
| preview | `01fc390cf46521d11774b9c2a2090a5507f97dba` | PostgreSQL 18.4, healthy | 0 queued, 1 failed |

Both returned HTTP 200 with `ok: true`, `db.ok: true`, and the expected CSP, HSTS, frame,
referrer, and content-type headers. The production Worker is therefore deployed and healthy; the
old uptime-workflow comment saying it did not exist was stale. The workflow now polls both
canonical origins every 15 minutes and cannot silently skip production when a repository variable
is absent.

## Strict production smoke

The production smoke was run with the deterministic seeded event, form, and headshot identifiers:

```text
bash scripts/post-deploy-smoke.sh https://sb-web.yi-ding.workers.dev --production --strict
```

Three checks passed:

- `/api/health` is healthy and database-backed;
- the admin route redirects an anonymous request to sign-in;
- `/api/test/login` returns 404 in production.

Five fixture-backed checks failed with 404: public agenda, agenda embed, public schedule API, CFP,
and public headshot. Production has no seeded smoke event. This is not an artifact crash, but it
means the protected workflow cannot yet produce a strict green post-deploy proof. Do not solve it
by wiping or seeding production without an explicit operator decision. The release needs either a
dedicated non-customer smoke tenant with stable fixtures or an approved production seed, followed
by all three `SMOKE_*` protected-environment variables.

## Secret inventory

`wrangler secret list` was read for both web environments and both jobs Workers. Jobs has the
required `CRON_SECRET`. The web Workers have the original database/session/R2/Resend baseline but
both are missing:

- `RESEND_WEBHOOK_SECRET` — bounce/complaint webhook verification;
- `UNSUBSCRIBE_SECRET` — non-essential email unsubscribe links;
- `SPEAKER_SHARE_SECRET` — public speaker-share links.

These names were previously documented as optional even though customer-facing paths fail only
when used. The runtime contract now requires them in every deployed environment, local and
protected deploy paths compare Cloudflare's secret-name inventory before building, and the
protected workflow performs the check before database migration. No secret values are read or
printed by the preflight.

## Artifact and release gates added

- Node is pinned to major 22 locally and in `package.json`, matching CI.
- `pnpm release:check` is the one credential-free release gate.
- Production dependencies now fail a release and the static CI job on any known advisory through
  `pnpm audit --prod --audit-level=low`. The initial audit found three high- and three
  moderate-severity advisories in the transitive `esbuild@0.18.20`, `postcss@8.4.31`, and
  `sharp@0.34.5` graph. Reviewed workspace overrides resolve those edges to `esbuild@0.25.4`,
  `postcss@8.5.26`, and `sharp@0.35.2`; the frozen lockfile installs cleanly, the resolved graph
  contains none of the vulnerable versions, and the final production audit reports no known
  vulnerabilities.
- Worker builds isolate ignored `.dev.vars`/`.env*` files and restore them afterward, preventing
  developer credentials or configuration from changing the release artifact OpenNext produces
  or leaking into its deploy-time cache population.
- `pnpm smoke:worker` boots the built OpenNext artifact under local workerd and exercises five
  independent entries. It passes on the current artifact and scans the runtime log for missing
  module/chunk failures. CI now runs it after `build:worker`; this directly covers the class of
  failure that caused the prior all-routes `Unknown chunk` incident while static gates stayed
  green.
- The deploy workflow validates required protected inputs and remote secret inventories before
  migration, then retains the existing strict post-deploy smoke.
- Billing is explicitly excluded from the deployed launch surface while the only adapter is the
  stub: committed preview/production configuration uses `BILLING_MODE=disabled`, deployed env
  validation rejects scaffold mode, and the navigation, page, API, checkout, and webhook are
  unavailable. The scaffold remains opt-in for local contract testing only.
- Unexpected API/job failures and uncaught Next render/action/route failures now retain raw
  diagnostics in Cloudflare Workers Logs while writing privacy-safe minute aggregates to Postgres
  through `ctx.waitUntil()`. `/api/health` exposes only a one-hour count, and the scheduled uptime
  check pages on any recent unexpected error or on failure of the aggregate query itself. The
  daily cleanup job retains seven days of buckets. The strict post-deploy smoke requires the new
  health field, while scheduled monitoring treats a missing field as a warning during the
  one-deploy rollout from the older live artifact.
- The scheduled jobs dispatcher now gives each downstream request a 120-second deadline, lets all
  due sibling jobs settle, and rejects its `waitUntil()` aggregate on any failure so Cloudflare
  Cron Past Events records failure instead of success. Its logs never read downstream response
  bodies; raw diagnostics remain in the web Worker's single error-capture seam. The deferred
  Airtable contract stub is no longer scheduled, and runtime validation rejects
  `AIRTABLE_CRON=1` until a real adapter and acceptance proof exist.

## Local release proof

`pnpm release:check` completed successfully against the final worktree. It proved:

- type-check, lint, and repository invariants are clean;
- the production dependency audit reports no known vulnerabilities;
- all 210 Vitest files and all 1,520 tests pass;
- committed Cloudflare declarations match the clean configuration;
- the production Next/OpenNext Worker build completes;
- first-load browser JavaScript is 135.8 KiB gzip and the lazy editor is 66.8 KiB gzip;
- all 206 Worker server chunks are present and the Worker is 2,497.21 KiB gzip, below the
  Workers Free 3 MiB limit;
- `/`, `/login`, `/signup`, `/events`, and `/api/health` load under local workerd, with health
  returning the expected 503 because the isolated smoke deliberately has no database.

The local shell was Node 26.5.0 and emitted the newly enforced engine warning. CI and the
repository toolchain are pinned to Node 22; a protected release will therefore use the supported
major rather than silently inheriting an arbitrary operator runtime.

The production license inventory also completed successfully: 176 MIT, 12 Apache-2.0, seven ISC,
two BSD-3-Clause, and one each of BSD-2-Clause, 0BSD, CC-BY-4.0, and LGPL-3.0-or-later packages.
The LGPL entry is sharp's prebuilt libvips runtime rather than application source. This is an
engineering inventory, not a substitute for counsel's distribution review.

## Open release blockers

1. Provision independent unsubscribe and speaker-share keys in preview and production, and create
   the matching Resend webhooks so the real signing secrets can be installed.
2. Choose and provision the production smoke-fixture strategy; populate `SMOKE_EVENT_ID`,
   `SMOKE_FORM_ID`, and `SMOKE_HEADSHOT_FILE_ID` in the protected environment.
3. Run the protected `Deploy` workflow through migration, web, jobs, and strict smoke to green.
4. Complete the remaining external acceptance evidence already named in `README.md` and
   `plan/status.md` (notably Outlook/calendar delivery and the unresolved deployed e2e blocks).

Until those items have direct evidence, the application is healthier and its release process is
fail-closed, but the production-readiness goal is not complete.
