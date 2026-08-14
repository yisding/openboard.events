# Architecture remediation plan

This plan turns the architecture review findings into an ordered set of small,
independently reviewable pull requests. Each workstream has an explicit safety
boundary and a measurable exit condition. Correctness, tenant isolation, and
user-visible behavior remain fixed unless a workstream explicitly changes a
public contract.

## Current state

The application is a Next.js App Router product compiled by OpenNext into one
Cloudflare web Worker, plus a small scheduled jobs Worker. Postgres is the system
of record, R2 stores uploads and the incremental cache, and feature directories
own most domain behavior. This is a sound deployment shape, but several local
choices now create global coupling or operational ceilings.

Fallback admin authentication was retired in merged PR #345. Better Auth is now
the only admin identity and credential provider while speaker portal
OTP/magic-link auth remains separate. The provider switch, stateless admin JWT,
password mirroring, and test-only cookie-minting endpoint are gone;
`users.password_hash` is erased and constrained; and browser automation signs in
through the real password endpoint. Review also uncovered and closed the E2E
reset path that wiped Better Auth credentials without recreating them.

## Sequencing and workstreams

### 1. Establish architectural and schema guardrails

Create an import graph report and classify every existing cross-feature edge as
contract, composition, or violation. Add ESLint/AST rules that permit feature
imports only through public barrels and forbid server modules from importing UI
or route modules. Break current cycles one vertical slice at a time by moving
shared types into `src/shared/contracts` and orchestration into explicit
application services.

Replace regex-only invariants with AST-aware lint rules where syntax matters.
Keep greps only for literal configuration and generated-artifact checks. Build a
Drizzle metadata baseline from the authoritative SQL, document which advanced
constraints remain SQL-only, and add a CI schema-diff gate. Test fixtures that
need the product schema must apply the migration journal or a generated snapshot,
not hand-picked migration subsets.

Exit criteria:

- The dependency graph has no feature cycles and CI rejects a new one.
- Cross-feature runtime imports use a documented public interface.
- A clean database produced by migrations and the TypeScript query schema pass
  an automated drift report with an explicit allowlist for SQL-only constructs.
- No syntax-sensitive architectural rule depends solely on regular expressions.

### 2. Remove per-event submission serialization

Split the final-submit transaction into independent invariants. Read event/form
availability at the transaction timestamp without locking the event row. Replace
the event-wide sequential proposal-code counter with collision-resistant public
codes, or allocate code blocks outside the request transaction if sequential
codes remain a product requirement. Enforce per-speaker caps with a row scoped to
the event and participant, so unrelated speakers never contend on one lock.
Preserve receipt-based idempotency and the immutable submitted snapshot.

Ship this behind a schema-compatible write path, compare old and new decisions in
logs, then remove the event `FOR UPDATE` after the comparison is clean.

Exit criteria:

- A 50-concurrent single-event test completes without a queue proportional to
  request count, duplicate codes, cap violations, or post-deadline acceptance.
- Lock telemetry shows no event-row lock on the final-submit path.
- Replay, close-boundary, and same-speaker cap races have database-backed tests.

### 3. Make the Worker artifact a supported build product

Inventory the custom Webpack/chunking changes and remove each one that is no
longer required by the pinned Next.js/OpenNext pair. Keep the existing workerd
boot smoke, but expand it to exercise a static page, dynamic server component,
API route, auth route, R2-backed cache path, and a lazy client chunk. Add a
preview canary that runs before production promotion and records compressed
size, module count, and cold-start failures.

Define an upgrade matrix for Next.js, OpenNext, Wrangler, and compatibility date:
one dependency PR, artifact smoke, preview soak, then production. Do not accept a
custom chunk optimization without a reproduction test against the built Worker.

Exit criteria:

- No unsupported/manual named-chunk assumptions remain.
- The built artifact is booted and probed in CI and after preview deployment.
- Version upgrades have a documented compatibility test instead of relying on
  `next build` alone.

### 4. Unify client data consistency

Choose React Query as the mutation and client-cache authority. Introduce feature
query-key factories and server-prefetch/hydration helpers. Mutations update or
invalidate exact keys; `router.refresh()` is reserved for navigation or server
component state that has no query representation. Remove route-local query-key
strings and duplicated server-prop/client-fetch ownership.

For each migrated screen, specify which data is server-rendered, which is live,
and the freshness/error behavior. Migrate one feature at a time, starting with
the admin surfaces with the most post-mutation refresh logic.

Exit criteria:

- One documented consistency model covers every interactive admin screen.
- No mutation needs both broad query invalidation and `router.refresh()`.
- Tests prove successful mutation, rollback/error, and cross-panel freshness.

### 5. Consolidate outbox delivery and remove public cron callbacks

Extract one outbox claim/deliver/retry engine that supports both event-scoped
communications and eventless platform-auth mail. Keep template rendering and
authorization in their owning features, but share state transitions, lease
recovery, backoff, idempotency, suppression, metrics, and dispatcher concurrency.
A compatibility adapter should drain both existing tables before any table
consolidation is considered.

Replace jobs-Worker calls to public `/api/jobs/*` endpoints with a Cloudflare
Service Binding or another platform-authenticated private invocation. Remove the
public cron routes and `CRON_SECRET` only after preview proves the private path.
Claim rows with `SKIP LOCKED` and process a bounded number concurrently so one
slow provider request does not serialize the batch.

Exit criteria:

- One tested state machine owns both outbox implementations.
- Scheduled work has no internet-addressable control endpoint or shared bearer
  secret.
- Multiple consumers safely drain one queue, and throughput/backlog age have
  alerts and load-test thresholds.

### 6. Clarify identity ownership

Write an identity map for product users, event contacts, and organization CRM
contacts, including creation authority, canonical email rules, consent,
suppression, merge behavior, deletion, and audit ownership. Introduce stable
link tables rather than adding more email-based joins. Resolve identity through
one service that returns explicit linked/unlinked/ambiguous outcomes.

Backfill links with an audit report, quarantine ambiguous matches for operator
review, dual-read during rollout, then switch consumers by feature. Do not merge
speaker portal auth into admin auth; the goal is explicit relationships, not one
credential model for people with different trust boundaries.

Exit criteria:

- Every identity table has one documented owner and lifecycle.
- Runtime joins between identity levels use stable keys rather than normalized
  email alone.
- Merge, erasure, invitation, and suppression tests cover linked and ambiguous
  identities.

### 7. Make public-cache invalidation explicit

Define freshness budgets for agenda, session, speaker, embed, and asset-backed
pages. Tag cached reads by event and entity, and centralize mutation-to-tag
invalidation in domain events rather than constructing paths at each writer.
Retain time-based revalidation only as a recovery bound.

Add a deployed test that warms each public surface, performs a mutation, and
observes the new value within its budget across canonical and embed URLs.

Exit criteria:

- Writers emit domain invalidations; they do not enumerate URL shapes.
- Every public surface has a named tag and freshness service level.
- Preview tests prove invalidation for all aliases and embeds.

### 8. Move staging objects to a lifecycle-compatible R2 prefix

Introduce `staging/evt_<eventId>/...` keys and version the key parser. New
uploads use the new layout; reads/finalization accept both layouts during the
migration. Copy live legacy staging objects with checksums, update database keys
transactionally, then enable and verify the R2 lifecycle rule on `staging/`.
Remove legacy parsing only after the maximum upload/finalization window passes.

Exit criteria:

- R2 can expire staging data with one prefix rule that cannot match published
  objects.
- Dual-layout tests cover presign, finalize, cleanup, and download authorization.
- An inventory report shows zero legacy staging keys before compatibility code
  is removed.

### 9. Protect sign-in capacity

Move a cheap, distributed IP and account-key rate limit ahead of password hash
verification, while preserving generic failure responses and the durable
application throttle. Benchmark the current PBKDF2 verifier in the deployed
Worker and set explicit per-isolate concurrency and latency budgets. Evaluate a
managed password verifier or a Worker-suitable current KDF only with a
rehash-on-login migration and measured CPU cost; do not raise the work factor
without capacity evidence.

Exit criteria:

- A hostile unpaced burst receives controlled 429s rather than Worker 1102s.
- Unknown-account and wrong-password paths remain enumeration-resistant.
- Credential verification latency, CPU failures, and throttle decisions are
  observable without logging addresses or passwords.

### 10. Complete operational hardening

Move DMARC from monitoring to enforcement in stages: inspect aggregate reports,
set a small-percentage quarantine policy, increase coverage, then move to reject
after every legitimate sender remains aligned. Record rollback criteria and keep
SPF/DKIM/DMARC checks in the delivery runbook.

Exit criteria:

- The production From domain publishes an enforced DMARC policy.
- Aggregate reports show no unidentified legitimate sender before `p=reject`.
- The runbook names owners, monitoring, and rollback thresholds.

## Proposed pull-request order

1. Fallback-auth retirement (completed in PR #345).
2. Import/schema/invariant guardrails.
3. Submission concurrency redesign.
4. Worker artifact compatibility hardening.
5. Shared outbox engine, then private scheduled invocation.
6. Client consistency and public-cache invalidation, feature by feature.
7. Identity link model and staged backfill.
8. R2 key migration and lifecycle enablement.
9. Sign-in capacity controls and DMARC enforcement.

Each PR must include migration rollback/forward-recovery notes when it changes
stored data, focused tests for the failure mode it closes, and before/after
measurements for performance or bundle changes. A checklist item is complete
only after preview deployment proves the relevant production-shaped behavior.
