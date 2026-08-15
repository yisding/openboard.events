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

The guardrail workstream is complete. PR #351 added a TypeScript-AST feature
graph with exact debt and cycle ratchets; PR #352 added a full migration journal
versus Drizzle metadata comparison, an explicit SQL-only ledger, and a
complete-schema integration fixture; and PR #356 replaced syntax-sensitive
repository greps with AST policies while retaining literal configuration and
CSS checks. PRs #359, #361, #362, #363, #365, and #368 published narrow runtime
contracts and reduced the direct-import ledger from 55 entries to zero. PR #369
extracted shared delivery and sealed-payload infrastructure, PR #371 established
event-contact ownership, and PR #372 introduced the CFP composition service;
together they reduced the seven-feature strongly connected group to none.

The resulting measurements are 43 feature dependency directions, zero direct
cross-feature implementation imports, zero cyclic groups, zero server-to-UI or
route imports, 88 tables, 779 modeled columns, 33 enums, and 43 migrations. CI
now ratchets each zero-debt architecture baseline and the migration/query-schema
comparison.

The submission-concurrency workstream is complete. PR #374 introduced the
durable `(event, form, contact)` cap guard while retaining the event lock for a
mixed-version rollout. PR #381 removed that broad lock, replaced the event
counter with collision-retrying Web Crypto public codes, and added a source
invariant preventing either final-submit owner from reintroducing the event-row
mutex. Its 50-speaker and cap-one race tests preserve snapshots and replay
semantics. The same review found two coupled assumptions: `now()` could accept a
request that waited across the close boundary, and the public API ordered pages
by the formerly monotonic code. The final implementation uses wall-clock form
availability and creation-tuple pagination with the existing code cursor token.

The Worker-artifact workstream is complete in PR #386. Removing the only custom
server-chunking override was tested rather than assumed: Next defaults produced
75 chunks / 758 handler inputs / 3,329.11 KiB gzip and exceeded the Workers Free
limit, while the retained numeric-chunk override produced 257 chunks / 940
inputs / roughly 2,570 KiB gzip. The supported Next/OpenNext/Wrangler/date
matrix and removal gate are now explicit. CI boots the built artifact under
workerd across dynamic, static/R2, API, auth, redirect, and lazy-client paths;
records artifact and cold-start metrics; and rejects missing emitted chunks.
Deploys repeat the size contract before mutation, and production now has an
explicit `needs: preview` dependency on the same commit's complete canary.
PR #407 then kept the release SHA server-only, and PR #409 enabled Wrangler's
supported final minification pass after a no-runtime-change rebuild exposed the
remaining compression variance at the Free-plan ceiling. Hosted builds of the
same 949-input / 262-chunk graph now compress to roughly 2,350 KiB instead of
3,069–3,073 KiB, restoring more than 700 KiB of operational headroom without
changing the Webpack chunk contract.

The scheduled-delivery workstream is complete in PRs #389, #396, and #403.
Both email outboxes now use one claim/deliver/retry engine with bounded
recipient-lane concurrency, `SKIP LOCKED` claims, shared retry accounting, and
documented queue-age thresholds. The jobs Worker invokes a closed named
entrypoint over an account-scoped Service Binding and holds no application
variables or secrets. Preview recorded three consecutive healthy RPC ticks
before removal; the removal release then proved both the internal namespace and
the retired `/api/jobs/*` namespace return `404` publicly. `CRON_SECRET` was
deleted from both preview Workers, and the resulting secret-change jobs version
completed another RPC tick successfully.

The client-consistency workstream is complete in PRs #404, #405, #406, and
#408. Communications, Agenda, and Dashboard now hydrate one shared query cache
from server-prefetched data; feature-owned key factories drive exact mutation
invalidation; and RSC-only or response-local screens are explicitly recorded
instead of being forced into a second client owner. The final AST guardrails
reject production-local Query clients/providers, `useQuery` `initialData`,
literal query keys (including shorthand aliases), and modules that combine
query invalidation with `router.refresh()`.

The identity-ownership workstream is complete in PRs #410, #411, and #412.
Migration `0041` added stable product-user/event-contact links, a PII-free
backfill audit, and ambiguous-match quarantine. Invitation and reminder writers
now provision links explicitly; reminder reads use stable keys only. CRM merge,
erasure, suppression, invitation, and ambiguous-recipient tests cover the
cross-identity boundaries, while the final AST guard resolves renamed imports,
namespace imports, and table aliases before rejecting feature-local email
joins.

The public-cache workstream is complete in PR #414. Public schedule, speaker,
event-metadata, and embed reads use stable event-scoped domain tags with a
60-second recovery bound; committed writers invalidate only the affected
domains after their database work succeeds. Public embed reads are side-effect
free, including the legacy speaker-list fallback dependency. Preview canary run
31822004587 warmed every canonical, legacy, and embed alias, changed schedule,
speaker, event, and embed state, and observed each result inside the 10-second
mutation budget. The run also proved that React's server-rendered hydration
markers must be removed before comparing visible text in raw HTML.

The R2 staging-layout workstream is complete in PRs #415, #416, #417, and #419.
New uploads use the lifecycle-covered `staging/evt_<eventId>/...` namespace, the
two-day `staging/` lifecycle rule is reconciled without replacing unrelated
rules, and the deployed browser canary exercises a real presign, R2 upload,
finalization, and published row. The bounded migration copied and fingerprinted
legacy objects before compare-and-swap row updates. Preview run 31833950542 and
production run 31835677697 each completed a fresh post-presign-window inventory
with zero legacy rows, zero legacy objects, and zero failures. Compatibility
parsing, scheduling, and the private runtime name are removed. The completed
checkpoint table and heartbeat value remain as inert database tombstones so a
retained older Worker version can still be rolled back safely.

The sign-in-capacity workstream is complete in PR #418. Atomic Postgres IP and
account-key burst guards run before the durable application throttle and PBKDF2,
and each Worker isolate admits at most one credential verification at a time.
The exact implementation commit passed preview and production promotion in run
31843683115. Its deployed hostile-burst gate returned one generic `401` and
eleven controlled `429` responses across twelve requests, with no `5xx` and a
2,251 ms p95 against the 5,000 ms budget.

Operational hardening has entered its final evidence-gathering phase. PR #420 added a
production-protected, serialized Cloudflare DMARC reporting workflow and a
runbook with owner, approved Resend path, stage dwell times, evidence gates, and
rollback thresholds. After the production zone ID was recorded, read-only run
31846568946 reached the DMARC endpoint directly and failed safely with a `403`,
proving that the existing Worker deployment token does not have DMARC access.
PR #421 separates a zone-scoped DMARC Read/Write credential and requires that
zone ID without granting Zone Read. Protected run 31862396508 then enabled and
verified reporting at `2026-08-15T03:40:22Z`; Cloudflare and Google DNS resolve
the generated `rua`, policy remains `p=none`, and the initial approved-source
inventory is empty. The earliest possible quarantine-10 entry is
`2026-08-22T03:40:22Z`, and only if reports from two independent receivers plus
Gmail and Outlook `dmarc=pass` evidence satisfy the runbook gates.
PR #423 records that live baseline and separates completed reporting setup from
the enforcement checklist. Production probes at `2026-08-15T03:50Z` then passed
aligned DKIM, SPF, and DMARC at both Gmail and Outlook; Outlook also reported
`compauth=pass`, but placed its message in Junk. Gmail placed its message in
Inbox. After confirming that this repository's Resend configuration is the only
sender for the exact From domain, the repository/zone owner approved a compressed
rollout and published `p=quarantine; pct=100` at
`2026-08-15T04:36Z`. This skips, but does not claim completion of, the originally
planned reporting, quarantine-10, and quarantine-50 dwell periods. The policy is
scoped to `_dmarc.mail.openboard.events`; the apex reporting record and unrelated
apex-domain mail remain unchanged.

PR #430 established `Openboard <hello@mail.openboard.events>` as the one From and
Reply-To identity for both application outboxes. Resend Receiving verified the
priority-10 inbound MX at `mail.openboard.events`, and a fresh provider-level
message appeared in its Receiving feed. PR #431 records that external state and
closes a status-observability gap: the protected operation now distinguishes the
apex reporting policy from the sender-subdomain enforcement policy and fails when
Cloudflare and Google public DNS disagree. The remaining roadmap gate is reject:
full quarantine must produce two independent aggregate-report periods with no
unidentified passing source or legitimate failure, followed by no-regression
Gmail and Outlook authentication and placement probes.

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

Status: complete in PRs #351, #352, #356, #359, #361, #362, #363, #365,
#368, #369, #371, and #372.

### 2. Remove per-event submission serialization

Split the final-submit transaction into independent invariants. Read event/form
availability at the wall-clock decision point without locking the event row. Replace
the event-wide sequential proposal-code counter with collision-resistant public
codes, or allocate code blocks outside the request transaction if sequential
codes remain a product requirement. Enforce per-speaker caps with a row scoped to
the event, form, and participant, so unrelated speakers never contend on one lock.
Preserve receipt-based idempotency and the immutable submitted snapshot.

Ship this behind a schema-compatible write path, compare old and new decisions in
logs, then remove the event `FOR UPDATE` after the comparison is clean.

Exit criteria:

- A 50-concurrent single-event test completes without a queue proportional to
  request count, duplicate codes, cap violations, or post-deadline acceptance.
- Lock telemetry shows no event-row lock on the final-submit path.
- Replay, close-boundary, and same-speaker cap races have database-backed tests.

Status: complete in PRs #374 and #381.

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

Status: complete in PRs #386, #407, and #409. The custom override remains
intentionally because the measured Next default exceeds the compressed Worker
limit; its exact removal conditions and reproduction are documented with the
supported matrix.

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

Status: complete in PRs #404, #405, #406, and #408. The screen-by-screen
ownership/freshness/error ledger is maintained in
`docs/client-data-consistency.md`, and CI enforces the zero-debt ownership
boundaries.

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

Status: complete in PRs #389, #396, and #403. The two table-specific adapters
remain intentionally separate, but one tested engine owns their lifecycle.
Preview proved the private transport before the public adapter was removed and
again after both preview `CRON_SECRET` bindings were deleted. Delete any retired
production bindings only after the matching release is promoted there.

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

Status: complete in PRs #410, #411, and #412. The additive migration backfilled
and audited existing memberships, the compatibility release established
dual-write, and the cutover release removed the last legacy read join. The
organization-authorized erasure candidate is confined to the explicit resolver
and aborts on ambiguous merge ancestry.

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

Status: complete in PR #414. Mutation coverage is behavioral rather than
source-shape based, and route exports identify the writer under test by HTTP
method so declaration reordering cannot silently change the assertion target.

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

Status: complete in PRs #415, #416, #417, and #419. Both protected environments
proved a full zero inventory after the legacy presign window before compatibility
code and scheduling were removed. Database tombstones remain intentionally for
the documented mixed-version rollback guarantee; no current runtime can invoke
the retired job.

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

Status: complete in PR #418. The exact commit passed both preview and production,
and the deployed twelve-request hostile burst stayed within the latency budget
with controlled generic responses and no Worker failure.

### 10. Complete operational hardening

Move DMARC from monitoring to enforcement in stages: inspect aggregate reports,
set a small-percentage quarantine policy, increase coverage, then move to reject
after every legitimate sender remains aligned. Record rollback criteria and keep
SPF/DKIM/DMARC checks in the delivery runbook.

Exit criteria:

- The production From domain publishes an enforced DMARC policy.
- Aggregate reports show no unidentified legitimate sender before `p=reject`.
- The runbook names owners, monitoring, and rollback thresholds.

Status: in progress in PRs #420, #421, #423, #430, and #431. Aggregate reporting,
full quarantine, the stable sender identity, and the reply-capable inbound route
are live. The repository/zone owner explicitly approved the compressed move to
`p=quarantine; pct=100` after confirming the single Resend sender inventory and
clean Gmail/Outlook alignment. That exception supersedes the earlier percentage
schedule without manufacturing dwell evidence. Before reject, full quarantine
must still produce two aggregate-report periods from independent receivers with
no unidentified legitimate sender or legitimate failure; Gmail Inbox and Outlook
Junk placement plus authentication must be rechecked for regression.

## Proposed pull-request order

1. Fallback-auth retirement (completed in PR #345).
2. Import/schema/invariant guardrails (completed in PRs #351, #352, #356,
   #359, #361, #362, #363, #365, #368, #369, #371, and #372).
3. Submission concurrency redesign (completed in PRs #374 and #381).
4. Worker artifact compatibility hardening (completed in PRs #386, #407, and
   #409).
5. Shared outbox engine and private scheduled invocation (completed in PRs
   #389, #396, and #403).
6. Client consistency (completed in PRs #404, #405, #406, and #408).
7. Identity link model and staged backfill (completed in PRs #410, #411, and
   #412).
8. Public-cache invalidation and deployed alias/embed verification (completed
   in PR #414).
9. R2 key migration and lifecycle enablement (completed in PRs #415, #416,
   #417, and #419).
10. Sign-in capacity controls (completed in PR #418).
11. DMARC reporting, sender stabilization, and enforcement (reporting and
    baseline evidence in PRs #420, #421, and #423; stable From/Reply-To and
    Receiving in PR #430; live full-quarantine record and independent policy
    observation in PR #431; evidence-gated reject remains open).

Each PR must include migration rollback/forward-recovery notes when it changes
stored data, focused tests for the failure mode it closes, and before/after
measurements for performance or bundle changes. A checklist item is complete
only after preview deployment proves the relevant production-shaped behavior.
