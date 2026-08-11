# M47 — Data lifecycle & GDPR

| | |
|---|---|
| **Status** | RETROACTIVE work order — **MERGED (rev. 12 / PR #95, merge `7b9cf3a`)**, no active claim. No schema change — reads/writes existing tables. `exportContactDataIn`/`exportOrganizationDataIn` (`src/features/data-lifecycle/server/{contact-export,organization-export}.ts`) bundle a contact's or organization's full record — profile, submitted answers, roster/session history, comms log, active tokens/sessions with **hashes stripped, never included** — behind two new `GET` routes. `eraseContactDataIn` deletes/anonymizes a contact across roughly 18 tables in FK-chain order, is the 10th function on the audited `withTx` list (a hard-capped, explicitly reviewed set — see Guardrails), returns a per-table deletion receipt, and purges the contact's orphaned R2 files immediately rather than waiting for the daily sweep. `runDataRetentionSweepIn` purges expired tokens/sessions 30 days past expiry and redacts rendered email bodies 90 days after send, wired into the existing `/api/jobs/cleanup` route (`Promise.all([cleanupOrphans(), runDataRetentionSweep(), nudgeStalledFileExports(), pruneExpiredFileExports()])`) so it runs on the pre-existing cron, not a new schedule. Draft `docs/legal/{privacy-policy,terms-of-service,dpa}.md` added, each headed `STATUS: DRAFT — not reviewed by counsel, not published, not binding`, written to match the codebase's actual data flows so a real version can be drafted from a correct starting point rather than boilerplate. Proven via `tests/integration/data-lifecycle.test.ts` (9 cases). Remaining before `DONE`: deployed/browser evidence — no request against `sb-web-preview` has exported or erased real contact data, and the retention sweep's effect has not been observed against `sb-test` data aged past its real cutoffs (only PGlite-seeded synthetic timestamps). See [`../status.md`](../status.md) §2g. |
| **Workstream / executing agent** | Product/auth-chain lane, orchestrated run `wf_5ed21edd-4b0`. |
| **Scheduled** | P4 commercial layer, alongside M45/M49 (hard-blocked on M43 only). |
| **Size** | L |
| **Paths owned** | `src/features/data-lifecycle/**`, `src/app/api/internal/organizations/[organizationId]/export/route.ts`, `src/app/api/internal/speakers/[eventId]/[contactId]/export/route.ts`, the retention-sweep call site in `src/app/api/jobs/cleanup/route.ts`, `docs/legal/**`, `tests/integration/data-lifecycle.test.ts`. |

## Objective

Give organizations and contacts real data-lifecycle rights over the product's own tables: export a
contact's or an organization's full record on request, erase a contact's data across every table it
touches (with an audit-grade receipt), and automatically purge expired tokens/sessions and redact
old rendered email bodies — plus draft legal documents that match what the system actually does
rather than generic boilerplate.

## Dependencies

- **Hard:** M43 (`exportOrganizationDataIn` composes members/invitations/audit-log/events, all
  M43/M44-owned tables).
- **Soft:** M07 (R2) — erasure purges the contact's orphaned files immediately, reusing the same
  delete path the daily orphan sweep uses.

## Provides (interfaces others consume)

```ts
// src/features/data-lifecycle/index.ts
export { exportContactData, exportContactDataIn, type ContactDataExport } from "./server/contact-export";
export { exportOrganizationData, exportOrganizationDataIn, type OrganizationDataExport } from "./server/organization-export";
export { eraseContactData, eraseContactDataIn } from "./server/contact-erasure";
export { runDataRetentionSweep, runDataRetentionSweepIn, type DataRetentionStats } from "./server/retention";
```

No downstream P4 module consumes these — like M41 and M45, this is a terminal leaf wired directly
into routes and the cleanup cron.

## Contract and data additions

- None. Every export/erasure/retention function reads or writes pre-existing tables; no new column,
  table, or `src/shared/contracts/**` type. `src/shared/contracts/data-lifecycle.ts` (added by this
  module) declares only the export/receipt response shapes already implied by the routes above.

## Acceptance criteria

Proven (PGlite, code-complete):

1. `exportContactDataIn` returns `null` for a contact id not on the given event, and otherwise
   assembles the full bundle — profile, submitted answers, roster, comms, tokens/sessions **without
   hashes** — for one that is (`tests/integration/data-lifecycle.test.ts:213,217`).
2. `eraseContactDataIn` throws `NOT_FOUND` for an unknown contact, and for a real one deletes/
   anonymizes every table the contact's data reaches while never touching a co-speaker's rows;
   `exportContactDataIn` returns `null` for the same contact immediately afterward
   (`data-lifecycle.test.ts:239,245,352`).
3. `runDataRetentionSweepIn` purges tokens/sessions expired past their grace window, leaves
   recently-expired and live rows alone, and is idempotent — a second run finds nothing left to
   sweep (`data-lifecycle.test.ts:399,433`).
4. `exportOrganizationDataIn` returns `null` for an unknown organization and otherwise composes the
   organization's own admin data — profile, members, pending invitations, audit log, events
   (`data-lifecycle.test.ts:462,466`).
5. `pnpm exec vitest run tests/integration/data-lifecycle.test.ts` is green (9/9) — one per AC
   line-citation above, which sum to exactly 9.

Deployed evidence — **outstanding**:

6. A real contact export and a real (disposable, seeded) contact erasure run against `sb-test`
   through the deployed routes, with the returned per-table receipt inspected.
7. A real organization export run against a seeded organization through the deployed route.
8. The retention sweep's effect observed against rows genuinely aged past the 30-/90-day cutoffs on
   `sb-test`, not only PGlite fixtures with synthetic timestamps. No `e2e/**` spec covers any of
   this.

## Guardrails

- `eraseContactDataIn` is the 10th function on the audited `withTx` runtime list — adding an 11th
  requires the same explicit review every prior addition got; this module does not introduce a
  second transactional-erasure implementation elsewhere.
- Exports never include token/OTP/password hashes, under any code path — this is checked directly
  in `data-lifecycle.test.ts:217`, not left to inspection.
- The retention sweep runs on the existing `/api/jobs/cleanup` cron; this module does not add a
  second schedule or a new cron binding.
- `docs/legal/**` are explicitly marked DRAFT/not binding; nothing links them as if they were live
  policy.
