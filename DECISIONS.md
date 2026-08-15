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
- The jobs Worker holds no application variables or secrets. Its only application capability is
  the `WEB_JOBS` Service Binding to the matching web Worker's named `JobsEntrypoint`; jobs execute
  directly inside the web Worker and there is no public callback or shared bearer credential.
- Runtime variables are validated fail-closed; retired auth settings are rejected, and
  production cannot enable the fallback delivery UI, `EMAIL_MODE=log`, or an email allowlist.

## R2 key scheme and lifecycle

Pending objects are keyed `staging/evt_<eventId>/...`, while published objects remain under
`evt_<eventId>/...`. That bucket-root boundary lets the `expire-staging` lifecycle rule target
only unfinished uploads. The daily `cleanupOrphans` sweep lists that same prefix as an
application-level backstop, and the parser accepts only the current root-prefixed layout. See
`docs/runbooks/r2-lifecycle.md` for provisioning and verification.

## Known operational limits

- **Sign-in retries are deliberately capacity-bound.** PBKDF2 remains at 100,000 native-WebCrypto
  iterations, with one verification in flight per isolate. Postgres admits one attempt per trusted
  IP and three attempts per normalized account key per second ahead of the existing five-per-15-minute durable
  throttle. Legitimate retries inside that one-second window receive a generic `429`; the preview
  deployment gate proves an unpaced burst cannot escape as Worker `1102`/`503`. See
  `docs/runbooks/sign-in-capacity.md`.
- **DMARC changes are report-gated and From-subdomain scoped.** Cloudflare DMARC Management
  collects aggregate reports from the organizational record. Enforcement is published at
  `_dmarc.mail.openboard.events`, matching the only production From domain, so unrelated apex
  mail is not changed accidentally. Production-environment approval and the dwell/evidence gates
  in `docs/runbooks/dmarc.md` are required before each quarantine or reject stage. Protected run
  31862396508 enabled and verified aggregate reporting at `2026-08-15T03:40:22Z`; policy remains
  `p=none` while the seven-day, two-receiver evidence window is collected. Production probes at
  `2026-08-15T03:50Z` passed aligned DKIM, SPF, and DMARC at both Gmail and Outlook, and Outlook
  also passed composite authentication. Outlook placed its passing message in Junk, which is
  recorded as the pre-enforcement reputation/content baseline and must be retested before the
  first quarantine stage; it is not attributed to a `p=none` DMARC action.
