# M48 — Observability & ops

| | |
|---|---|
| **Status** | RETROACTIVE work order — **MERGED (rev. 11 / PR #94, merge `c662345`)**, no active claim. `/api/health` deepened with a `comms` block (`src/app/api/health/comms-health.ts`: queued/failed counts and oldest-queued age in whole seconds, clock-skew-safe, degrading to a generic error result rather than throwing or leaking the raw DB error when the aggregate query itself fails). Alerting thresholds fully documented in `docs/runbooks/alerting.md` (per-field healthy/warn/page table for `/api/health`, plus `pnpm worker:size`/post-deploy-smoke deployment thresholds). A curl-based uptime-check script (`scripts/uptime-check.sh`) and a scheduled `.github/workflows/uptime.yml` (every 15 minutes, matrix over preview/production) poll `/api/health` without deploying anything. `docs/runbooks/r2-lifecycle.md` and `docs/runbooks/pitr-rehearsal.md` written, plus (already-merged, cross-referenced here rather than duplicated) `backup-restore.md`/`rollback.md`. **A real finding surfaced and was recorded, not silently fixed:** `plan/modules/M07-r2-storage.md`'s outstanding item ("an R2 lifecycle rule expiring the `staging/` prefix") turns out to be unprovisionable as stated — every R2 object is keyed `evt_<eventId>/...`, so `staging` is the bucket's *second* path segment, not a prefix; no static `Prefix` filter authored once can isolate "any event's staging objects" under the current key scheme (`DECISIONS.md` "M48 observability & ops," 2026-08-10). Filed as a scoped M07-owner follow-up, not fixed here. **A second, more consequential gap found while writing this work order and not yet fixed by any module:** the merged `uptime.yml` unconditionally polls both `https://sb-web-preview.yi-ding.workers.dev` **and** `https://sb-web.yi-ding.workers.dev` from a hardcoded matrix — there is no skip-when-unconfigured gate, so every scheduled run has polled a production Worker that has never been deployed and gotten a 404, and the run has failed every single time since the workflow's activation (`gh run list --workflow=Uptime`: five consecutive `failure` runs at 15-minute intervals through 2026-08-10T21:58Z, each failing solely on the `Check production` job's `Poll /api/health` step; `Check preview` passes every time). This is exactly the failure mode the module's own design intent (a failed scheduled run *is* the alert) depends on not happening — a permanently red workflow trains whoever's on call to ignore it. Remaining before `DONE`: (a) the uptime workflow needs the skip-until-configured gate it was designed for but does not yet have, (b) neither the R2 lifecycle rule nor the Neon PITR rehearsal have actually been executed once — both runbooks are written but unexercised, and `pitr-rehearsal.md`'s own "record the rehearsal in `DECISIONS.md`" step has never fired. See [`../status.md`](../status.md) §2f and [`../../DECISIONS.md`](../../DECISIONS.md) "M48 observability & ops". |
| **Workstream / executing agent** | P3/P5 compliance lane, orchestrated run `wf_5ed21edd-4b0` (rev. 11). |
| **Scheduled** | Start anytime — no hard dependency. |
| **Size** | M |
| **Paths owned** | `src/app/api/health/{route,comms-health}.ts`, `docs/runbooks/{alerting,r2-lifecycle,pitr-rehearsal}.md`, `.github/workflows/uptime.yml`, `scripts/uptime-check.sh`. |

## Objective

Give the deployed application a health signal worth alerting on, document what "worth paging on"
actually means for each signal, wire a non-deploying scheduled check against it, and rehearse (or at
minimum document, pending an actual exercised run) the two disaster-recovery procedures — R2
lifecycle hygiene and Neon point-in-time restore — that back up `backup-restore.md`/`rollback.md`.

## Dependencies

- None hard — this module can start anytime per the roadmap. It reads `/api/health`'s pre-existing
  `db.ok` shape and the outbox's existing `communication_logs` table; it does not gate or get gated
  by any other P4 module.

## Provides (interfaces others consume)

```ts
// src/app/api/health/comms-health.ts
export async function commsHealth(sql: NeonQueryFunction): Promise<CommsHealth>;
```

`scripts/post-deploy-smoke.sh` and `scripts/uptime-check.sh` both consume `/api/health`'s response
shape (including this module's `comms` block); no other feature module imports `commsHealth`
directly.

## Contract and data additions

- None. `/api/health`'s response gains a `comms` field; this is a wire-shape addition to an
  unversioned internal ops endpoint, not a `src/shared/contracts/**` type (the route is
  ops-consumed, not client-consumed).

## Acceptance criteria

Proven (code-complete / unit-tested):

1. `commsHealth` reports zero counts and a null age when nothing is queued or failed
   (`src/app/api/health/comms-health.test.ts:23`).
2. It computes the oldest-queued age in whole seconds from the DB timestamp, treating a clock skew
   that puts the row in the future as age zero rather than negative (`comms-health.test.ts:28,40`).
3. It degrades to a generic error result instead of throwing or putting the raw DB error on the wire
   when the query fails, and defaults to zero counts/null age when the query returns no row at all
   (`comms-health.test.ts:48,57`).
4. `pnpm exec vitest run src/app/api/health/comms-health.test.ts` is green.
5. Every threshold in `docs/runbooks/alerting.md`'s `/api/health` table has a stated healthy/warn/
   page value and a one-sentence "why" — reviewed for completeness at merge.

Deployed evidence — **partially proven, with a real bug found**:

6. `Check preview` in the scheduled `Uptime` workflow passes against the live preview every run
   (confirmed: `gh run list --workflow=Uptime`, `Check preview` green on all five most recent
   scheduled runs through 2026-08-10T21:58Z).
7. **Outstanding / broken:** `Check production` fails every scheduled run because `uptime.yml`
   unconditionally polls `https://sb-web.yi-ding.workers.dev`, a Worker that has never been
   deployed (404). The module's own design intent — a documented skip-when-unconfigured gate reading
   a `UPTIME_PRODUCTION_URL` repository variable — was never implemented in the merged workflow. Fix
   direction: add the gate (resolve the origin from `vars.UPTIME_PRODUCTION_URL`, skip with a
   `::notice::` when empty, matching the pattern `vars.UPTIME_PREVIEW_URL` already half-establishes)
   or deploy production and stop treating its absence as configuration.
8. **Outstanding:** the R2 lifecycle rule described in `r2-lifecycle.md` has not been provisioned on
   either bucket — correctly so, per the finding above, since no static prefix rule is safe under
   the current key scheme until M07's `buildStagingKey` hoists `staging/` to the bucket root.
9. **Outstanding:** the Neon PITR rehearsal in `pitr-rehearsal.md` has never been run once; no entry
   exists in `DECISIONS.md` recording a rehearsal, which the runbook's own "Record the rehearsal"
   step requires after every run.

## Guardrails

- `commsHealth`'s failure is caught in its own try/catch inside the route so a transient lock
  contention on `communication_logs` never flips the whole `/api/health` response to down — only
  `db.ok: false` does that.
- The uptime check never deploys anything — it only checks out `scripts/uptime-check.sh` and polls
  over the network, so a stuck or bad deploy can never make this workflow itself the thing that's
  broken.
- A PITR rehearsal must never run against `sb-test` or `sb-prod` directly — always a disposable
  branch created off one of them, per `pitr-rehearsal.md`'s own ground rule.
- Any new `/api/health` field is additive only, per `alerting.md`'s own "Adding a new threshold"
  section — never rename or remove an existing field without updating
  `scripts/post-deploy-smoke.sh` in the same change.

## needs_owner

1. Either deploy the production Worker (`sb-web`) and set `UPTIME_PRODUCTION_URL`, or fix
   `.github/workflows/uptime.yml` to skip the production check until a production origin is
   configured — as currently merged, every 15-minute scheduled run reports `failure` for a reason
   that has nothing to do with the preview's actual health, and has done so since the workflow's
   first scheduled run.
2. Run the Neon PITR rehearsal (`docs/runbooks/pitr-rehearsal.md`) at least once against a disposable
   branch and record the result in `DECISIONS.md`, per the runbook's own closing step.
3. Provision the R2 lifecycle rule only after M07's key-scheme follow-up (`staging/` hoisted to the
   bucket root) lands — provisioning `Prefix: "evt_"` today would silently expire published files.
