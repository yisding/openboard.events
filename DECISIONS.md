# Openboard decisions

## Pinned versions

- Next.js `15.5.23` and `@opennextjs/cloudflare` `1.20.2`. OpenNext supports the latest Next.js 15 minor and the pair is frozen for the build.
- React `19.1.9`; zod v4; `date-fns` + `date-fns-tz` for the centralized time API.

## Spike results (S1–S4, C1–C2)

- Local Next.js production build: passed on 2026-08-08 with 42 routes.
- OpenNext Cloudflare build: passed on 2026-08-08; `.open-next/worker.js` was generated successfully.
- Unit checks cover condition evaluation, half-open interval overlap, agenda conflicts,
  sanitization, environment validation, and RFC 5545 calendar generation (35 passing tests).
- The deployed preview URL and Neon health query are proven below. Deployed interactive
  transactions, Auth.js, browser R2 presigning/CORS, and Resend delivery/idempotency remain
  pending their feature-specific probes.

## Deferred spikes (Sat AM)

- [ ] Revalidate-60 behavior on a deployed public page
- [ ] Browser presigned R2 upload with CORS
- [x] Apply both PostgreSQL migrations to a disposable Neon branch
- [ ] Embed `frame-ancestors *` survives the adapter

## Adopted fallbacks

- The local demo uses a typed, persisted browser store when external services are absent. Production adapters remain isolated behind server interfaces.

## Discord clarifications

- No clarifications recorded yet.

## Walkthrough-video diffs

- No video artifact is present in this checkout; the written plan is authoritative.

## Infra facts (Neon/R2/Resend/Airtable/WAF ids)

- Credentials are not present in the repository. The `sb` Neon project has isolated
  `sb-dev`, `sb-test`, and `sb-prod` branches; the committed migrations were proven on an
  expiring disposable branch and then applied to `sb-dev` and `sb-test` on 2026-08-08.
- Cloudflare has `sb-files-preview` and `sb-files` R2 buckets in WNAM with exact-origin CORS.
  The preview and production web origins are respectively
  `https://sb-web-preview.yi-ding.workers.dev` and
  `https://sb-web.yi-ding.workers.dev`; production is not deployed yet.

## PR #1 review checkpoint (2026-08-08)

- All 23 review threads (Codex + CodeRabbit) were fixed in `5ed137c`, replied to, and resolved.
- `conditionSchema` tightened before the CP1 freeze: `eq`/`neq`/`in`/`not_in` require `value`; `answered`/`empty` are presence-only.
- Jobs worker `APP_BASE_URL`: default (local) is `http://localhost:3000`; preview and production deploys require the exact matching web origin through `scripts/deploy-cloudflare.sh`. No guessed `workers.dev` hostname is committed. Re-assert the Wrangler-emitted URL here after provisioning or any URL change (M08 guardrail).
- Preview uses one generated `CRON_SECRET` on both `sb-web-preview` and `sb-jobs-preview`.
  Production remains unset and its job routes therefore continue to fail closed until the
  guarded production bootstrap.
- The demo store hydrates a validated whole-state snapshot (`HYDRATE`); seeded review records are the source of truth for submission score/reviewCount aggregates.

## Infrastructure configuration reconciliation (2026-08-08)

- Canonical Worker/R2 names and isolated preview/production bindings are encoded in Wrangler. Runtime variables are validated fail-closed; production cannot enable test auth, fallback delivery UI, or an email allowlist.
- GitHub Actions owns ordered deployment (direct Neon migration → web → jobs → smoke). Cloudflare Git integration stays disabled.
- The unsafe environment-wide API key was removed. Private API routes remain unavailable until M40 provides hashed, event-scoped database keys.
- Neon, preview Workers, and R2 are now provisioned as recorded below. Resend and production
  deployment evidence remain pending.

## Preview infrastructure proof (2026-08-08)

- `sb-web-preview` deployed at `https://sb-web-preview.yi-ding.workers.dev`; the repository
  smoke script passed its health, public schedule, and public API probes.
- `/api/health` returned `ok: true`, build SHA `0977873`, environment `preview`, and a
  successful Neon PostgreSQL `18.4` query in 155 ms.
- The deployed OpenNext Worker was 1206.45 KiB gzip with 24 ms startup time, within the
  Workers Free 3 MiB compressed-size budget. No CPU or resource-limit error occurred.
- OpenNext successfully populated five entries in the preview R2 incremental cache. The
  revalidate-60 and browser presigned upload/CORS probes remain pending.
- The first jobs tick exposed Cloudflare error 1042 because `sb-jobs-preview` fetched a
  sibling Worker on the same `workers.dev` zone. Adding the
  `global_fetch_strictly_public` compatibility flag preserved the intentional public
  `APP_BASE_URL` design. The next scheduled tick completed with Worker outcome `ok`; its
  authenticated `outbox` request returned HTTP 200 and `{ ok: true, stats: { noop: 1 } }`
  with 1 ms CPU time.
- GitHub environments `preview` and `production` are restricted to `main`; production
  requires `yisding` approval. `PRODUCTION_DEPLOY_ENABLED` remains unset. The Cloudflare
  deployment token is temporarily repository-scoped and must move to both protected
  environments before production.

## CP1 freeze record

- Contracts, migration schema, feature barrels, version pair, and invariant rules freeze after the foundation PR is accepted.
