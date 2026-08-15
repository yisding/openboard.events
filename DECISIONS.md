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

New temporary objects use `staging/evt_<eventId>/...`; finalized objects move outside that
prefix. Preview reconciles a two-day `staging/` lifecycle rule without replacing unrelated
bucket rules, and the application cleanup remains defense in depth. The bounded legacy migration
finished with zero remaining legacy rows or objects in preview and production; compatibility
parsing is retired. `docs/runbooks/r2-lifecycle.md` has the operational details.

## Mail identity and calendar cancellation

- Both application outboxes use `Openboard <hello@mail.openboard.events>` as one stable From and
  Reply-To identity. Resend Receiving owns the priority-10 `mail.openboard.events` inbound MX;
  its bounce return-path MX remains separate.
- A prepared calendar REQUEST stores the immutable event snapshot that its retry and any later
  CANCEL must reuse. Speaker removal, unpublish, unschedule, and hard delete all preserve a
  durable cancellation path; address changes fail closed instead of sending snapshot PII to an
  old address.
- The protected **Production mail delivery probe** is the supported live REQUEST/reschedule/CANCEL
  canary. Provider acceptance is application evidence, not proof of Inbox placement; Gmail and
  Outlook placement and authentication headers remain separately recorded receiver evidence.

## Known operational limits

- **The Worker artifact still needs the pinned chunk contract.** Next/OpenNext defaults exceed
  the Workers Free module limit; the supported numeric-chunk override and final minification keep
  the deployed graph within budget. Removing either requires a measured rebuild against the
  pinned version pair and the workerd smoke suite.
- **DMARC reject is evidence-gated.** `mail.openboard.events` publishes
  `p=quarantine; pct=100`. Reject waits for 48 hours and two independent aggregate-report periods
  with no unidentified legitimate sender or legitimate failure, plus no-regression Gmail and
  Outlook authentication and placement. Outlook Junk is the current placement baseline.
