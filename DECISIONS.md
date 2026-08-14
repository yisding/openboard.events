# Openboard decisions

Standing decisions that govern this codebase, each with its reason. Dated build-history
narratives were consolidated out; git history holds them.

## Pinned versions

- Next.js `15.5.23` and `@opennextjs/cloudflare` `1.20.2`. OpenNext supports the latest Next.js
  15 minor and the pair is frozen for the build.
- React `19.1.9`; zod v4; `date-fns` + `date-fns-tz` for the centralized time API.

## One runtime path: Postgres

Every screen reads and writes Postgres through the server layer. The early credential-free
browser demo (a localStorage store) was deleted on 2026-08-12; production adapters remain
isolated behind server interfaces, and there is no fixture fallback at runtime.

## Admin auth: Better Auth only

- Better Auth is the sole admin/organizer identity and credential provider, with revocable
  sessions in `admin_sessions`, email/password, verification/reset, and Google social login.
  Google-only sign-in was rejected because it locks out non-Google organizers and still needs
  reset/verification/revocation.
- The jose/PBKDF2 fallback provider, its `ob_admin` cookie, provider switch, password mirror,
  and test-only login route were retired in migration 0033. Historical
  `pbkdf2-sha256$…` values already copied into `admin_accounts` by migration 0009 still verify
  and rehash on first login; `users.password_hash` is erased and constrained to NULL.
- Do not combine Better Auth's `cookieCache` with `secondaryStorage` (a known bug treats an
  expired cache as logout). `requireAdmin(eventId, role?)` stays the frozen,
  implementation-neutral contract. Portal speaker OTP/magic-link auth is a separate system and
  does not move.

## Migration authorship

- The reviewed SQL files in `drizzle/` are authoritative. They contain composite tenant foreign
  keys, partial and NULL-aware unique indexes, views, and triggers that the Drizzle table
  declarations do not fully model.
- Migration generation is deliberately disabled until a complete Drizzle metadata baseline can
  reproduce those constraints without weakening them. The TypeScript schema remains available
  for query typing; schema changes are authored and reviewed directly in SQL, additive-only
  after the initial baseline.

## API access

- There is no environment-wide API key: it could not enforce event scope, so a leak would read
  every event. Programmatic access uses hashed (`sha256`-at-rest), event-scoped keys issued from
  **Settings → API keys** and enforced on every keyed `/api/v1` route (401-before-404).

## Contracts freeze (CP1)

Contracts, migration schema, feature barrels, the pinned version pair, and the invariant rules
are frozen. Contract or schema changes require an architect-labeled PR under the frozen
protocol.

## Deployment

- GitHub Actions owns ordered deployment: direct Neon migration → web Worker → jobs Worker →
  strict post-deploy smoke, through protected `preview` and `production` environments.
  Cloudflare's Git integration stays disabled.
- A successful `main` CI run deploys `preview` automatically and never promotes production,
  preserving a soak window. Production is a protected manual `workflow_dispatch`; choosing it
  always replays the same commit through a sequential preview migration, deploy, smoke, and
  browser canary first. The `preview` GitHub environment must have no required reviewer, or every
  merge queues an approval instead of deploying.
- The jobs Worker holds only `APP_BASE_URL` and `CRON_SECRET`. Deploys require the exact
  matching web origin through `scripts/deploy-cloudflare.sh` — no guessed `workers.dev`
  hostname is committed — and the `global_fetch_strictly_public` compatibility flag stays set so
  the jobs Worker can fetch its sibling on the same zone (Cloudflare error 1042 otherwise).
- Runtime variables are validated fail-closed; retired auth settings are rejected, and
  production cannot enable the fallback delivery UI, `EMAIL_MODE=log`, or an email allowlist.

## R2 key scheme and lifecycle

Objects are keyed `evt_<eventId>/staging/...`, so `staging` is the second path segment and no
static R2 lifecycle prefix rule can isolate staging objects (`Prefix: "staging/"` matches
nothing; `Prefix: "evt_"` would expire published files too). Orphan cleanup is therefore an
application-level sweep — `cleanupOrphans`, on the daily cron — until the `staging/` segment is
hoisted to the bucket root in `buildStagingKey` and its parsers. `docs/runbooks/r2-lifecycle.md`
has the full analysis.

## Known operational limits

- **Per-event submit throughput is serialized.** `createSubmissionIn` takes the event row
  `FOR UPDATE` before the final-submit checks, so one event sustains roughly 1.7 submits/sec
  (~580 ms per submit, flat under contention; verified with a 50-concurrent deployed load test:
  50/50 `200 ok`, zero duplicate codes). Correct by design, but a per-event ceiling worth
  knowing before marketing a launch-day rush.
- **Sign-in bursts are CPU-bound on Workers Free.** PBKDF2 at 100,000 iterations runs on every
  attempt (including unknown addresses against the dummy hash), so an unpaced burst can hit
  Cloudflare error 1102 (resource limits) before the application 429 does. The throttle itself
  holds: five attempts per email+IP per 15 minutes, then `429 RATE_LIMITED`.
- **DMARC is monitor-only.** Deliverability is proven aligned (`dkim=pass`, `spf=pass`,
  `dmarc=pass` on the `EMAIL_FROM` domain), but the published policy is `p=NONE`; tightening to
  `quarantine`/`reject` is optional hardening, not a gate.
