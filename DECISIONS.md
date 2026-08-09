# Openboard decisions

## Pinned versions

- Next.js `15.5.23` and `@opennextjs/cloudflare` `1.20.2`. OpenNext supports the latest Next.js 15 minor and the pair is frozen for the build.
- React `19.1.9`; zod v4; `date-fns` + `date-fns-tz` for the centralized time API.

## Spike results (S1–S4, C1–C2)

- Local Next.js production build: passed on 2026-08-08 with 42 routes.
- OpenNext Cloudflare build: passed on 2026-08-08; `.open-next/worker.js` was generated successfully.
- Unit checks cover condition evaluation, half-open interval overlap, agenda conflicts, sanitization, and RFC 5545 calendar generation (21 passing tests).
- Deployed Neon transactions, Auth.js, R2, Resend delivery/idempotency, and preview URL checks remain pending environment credentials.

## Deferred spikes (Sat AM)

- [ ] Revalidate-60 behavior on a deployed public page
- [ ] Browser presigned R2 upload with CORS
- [x] Apply both PostgreSQL migrations to PGlite (75-test suite on 2026-08-08; 30+ tables, 8 views, and all 9 M03 invariants pass)
- [ ] Apply both PostgreSQL migrations to a disposable Neon branch (blocked locally: `DATABASE_URL_DIRECT` is not configured)
- [ ] Embed `frame-ancestors *` survives the adapter

## Adopted fallbacks

- The local demo uses a typed, persisted browser store when external services are absent. Production adapters remain isolated behind server interfaces.

## Discord clarifications

- No clarifications recorded yet.

## Walkthrough-video diffs

- No video artifact is present in this checkout; the written plan is authoritative.

## Infra facts (Neon/R2/Resend/Airtable/WAF ids)

- Credentials are not present in the repository and no external resources have been mutated.

## PR #1 review checkpoint (2026-08-08)

- All 23 review threads (Codex + CodeRabbit) were fixed in `5ed137c`, replied to, and resolved.
- `conditionSchema` tightened before the CP1 freeze: `eq`/`neq`/`in`/`not_in` require `value`; `answered`/`empty` are presence-only.
- Jobs worker `APP_BASE_URL`: default (local) is `http://localhost:3000`; preview and production deploys require the exact matching web origin through `scripts/deploy-cloudflare.sh`. No guessed `workers.dev` hostname is committed. Re-assert the Wrangler-emitted URL here after provisioning or any URL change (M08 guardrail).
- `CRON_SECRET` is not yet set anywhere; job routes fail closed (401) while it is unset. Set it on both matching workers with an explicit `--env preview` or `--env production` (and `--config workers/jobs/wrangler.jsonc` for jobs) when credentials arrive.
- The demo store hydrates a validated whole-state snapshot (`HYDRATE`); seeded review records are the source of truth for submission score/reviewCount aggregates.

## Infrastructure configuration reconciliation (2026-08-08)

- Canonical Worker/R2 names and isolated preview/production bindings are encoded in Wrangler. Runtime variables are validated fail-closed; production cannot enable test auth, fallback delivery UI, or an email allowlist.
- GitHub Actions owns ordered deployment (direct Neon migration → web → jobs → smoke). Cloudflare Git integration stays disabled.
- The unsafe environment-wide API key was removed. Private API routes remain unavailable until M40 provides hashed, event-scoped database keys.
- These are code/configuration decisions only. External Cloudflare, Neon, R2, and Resend resources and deployed evidence remain pending.

## CP1 freeze record

- Contracts, migration schema, feature barrels, version pair, and invariant rules freeze after the foundation PR is accepted.
