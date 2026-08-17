# R2 lifecycle rules

The `sb-files-preview` and `sb-files` buckets expire unfinished browser uploads under a dedicated
bucket-root prefix. This runbook owns the durable key boundary, lifecycle reconciliation, and
verification.

## What a presigned upload leaves behind

`buildStagingKey` (`src/shared/server/r2.ts`) writes every new presigned-PUT target as:

```
staging/evt_<eventId>/<kind>/<fileId>/<filename>
```

and the published key `finalizeUpload` copies it to, once validated, is:

```
evt_<eventId>/<kind>/<fileId>/<filename>
```

The URL is signed over `content-length` as well as `host`, so it accepts exactly the size presign
approved and nothing else — R2 recomputes the signature against the Content-Length the browser
derived from the File body, and a substituted body fails the signature rather than the later
inspection. `content-type` is deliberately left unsigned: a charset suffix or a case difference
would fail an otherwise valid upload for no security gain, and the type is re-established from the
landed bytes by `inspectPublished` and served from the database row by `publicFileHeaders`. The
post-copy inspection is still the authority on what is *published*; the signed length is what keeps
a single approved presign from writing an unbounded object into `staging/` in the first place.

A browser that never completes the PUT, or completes it but never calls finalize, leaves a staging
object behind unless something reclaims it. The application has two cleanup paths:

- **`cleanupOrphanUploads`** deletes a `file_assets` row (and its object) once the row is older
  than the TTL and orphaned by the DB-side predicate.
- **`sweepOrphanStagingObjectsIn`** lists only the bucket-root `staging/` prefix via the S3 API,
  parses the current layout, keeps old keys with no owning `file_assets` row, and deletes them.

The speaker portal's file-request task depends on this deliberately (#621): its POST finalizes the
staged object and completes the task in one request, so a speaker who loses the network after the
PUT leaves a staging object and an outstanding task rather than a published file attached to
nothing. If both sweeps stop running, that path accumulates staged bytes — it does not corrupt
anything.

Both run daily via `cleanupOrphans`, wired to the `cleanup` job at 09:00 UTC
(`workers/jobs/dispatch.ts`). **This is the durable app-level mitigation** — an R2-native lifecycle
rule is additional defense in depth (it survives even if the cron stops ticking, or a future code
path forgets to call the sweep), not a replacement for it.

## Safety boundary

R2 object lifecycle rules use the same `PutBucketLifecycleConfiguration` shape as S3: a rule's
`Prefix` filter matches an object key **only when the key begins with that exact string**
(anchored at position 0 — `Prefix: "logs/"` matches `logs/2026-08-09.txt`, never
`app/logs/2026-08-09.txt`). Pending objects start with `staging/`; published objects start with
`evt_`. The fleet-wide rule therefore cannot match immutable downloads.

Finalization recognizes only the current staging layout, while download authorization recognizes
only the published layout. The event-first staging shape was retired after both environments
completed a full zero-inventory cycle beyond the 15-minute presign lifetime. Rolling this release
back to the preceding compatibility release remains safe because that release accepts the current
root-prefixed layout too.

### Compatibility retirement evidence

PR #416 deployed the dual-layout migration checkpoint and gated deployments on a fresh, complete
inventory. Deploy run `31833950542` proved preview at commit `6964d511`; its checkpoint completed
at `2026-08-14T19:15:14.376Z` with zero database rows, zero bucket objects, and zero failures.
Production deploy run `31835677697` promoted merge commit `2c0bf6f0` and completed its independent
checkpoint at `2026-08-14T20:30:12.909Z` with the same zero counts. Both checkpoints began more
than 15 minutes before completion, exhausting every pre-existing presigned PUT URL before the
legacy parser, migration implementation, scheduler, and deployment gate were removed. The private
job name resolved to a no-op for one ordered deployment so an old jobs Worker could not fail while
web and jobs were replaced. After that scheduler-free release reached production, the runtime
adapter was removed.

The completed `r2_staging_migration_state` table and the database heartbeat constraint's
`r2-migration` value remain as inert rollback tombstones. Current code cannot invoke or name the
job, but Cloudflare retains older Worker versions and the rollback runbook guarantees those builds
can run against today's additive schema. Do not drop or narrow these database contracts while a
retained rollback target references them.

## What to actually provision, today

### Fleet-wide rule

```bash
# Preview bucket
pnpm exec wrangler r2 bucket lifecycle add sb-files-preview expire-staging staging/ \
  --expire-days 2

# Production bucket
pnpm exec wrangler r2 bucket lifecycle add sb-files expire-staging staging/ \
  --expire-days 2
```

`--expire-days 2` is deliberately looser than the app-level sweep's 24h TTL — this rule exists to
catch what the sweep misses (a stopped cron, a bucket the sweep can't reach because
`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` are unset — `hasR2Credentials` already degrades
gracefully rather than failing the cron tick over this), not to race it. Requires
`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` in the shell — the same credentials
`scripts/deploy-cloudflare.sh` uses (`docs/provisioning.md` §5).

Protected deployments call `pnpm r2:lifecycle:ensure preview|production` before deploying the
Workers. The command reads the whole lifecycle configuration, preserves rules owned elsewhere,
adds or repairs the exact `expire-staging` rule, and reads it back. A token without `Workers R2
Storage Write` fails the deployment before application code is changed.

### Dashboard steps (manual fallback)

1. Cloudflare dashboard → **R2 object storage**.
2. Select the bucket (`sb-files-preview` or `sb-files`).
3. **Settings** tab → **Object lifecycle rules** → **Add rule**.
4. Name it (`expire-staging`); scope it to the prefix from the command above (leave the "apply to
   all objects" toggle **off** — an unscoped rule expires published files too).
5. Under **Delete objects**, set **Number of days after object was uploaded** to the value used
   above.
6. **Save changes**.

### Verify

```bash
pnpm exec wrangler r2 bucket lifecycle list sb-files-preview
pnpm exec wrangler r2 bucket lifecycle list sb-files
```

Each should print the rule's id, prefix and the expire-days condition. R2 applies lifecycle rules
on a background schedule (not instantly), so do not expect an object created seconds ago to
disappear on the next poll — use `sweepOrphanStagingObjectsIn`'s own listing (or the dashboard's
object browser) to confirm an object is actually gone, and re-check a day later, not a minute
later.

### Remove a rule

```bash
pnpm exec wrangler r2 bucket lifecycle remove sb-files-preview --id expire-staging
```

## Incomplete multipart uploads

Browser presigns are single-shot PUTs, while deliverables ZIP exports use R2 multipart uploads.
R2 buckets include a default rule that aborts incomplete multipart uploads after seven days. The
deployment reconciler preserves every unrelated rule, including that default; do not replace the
whole lifecycle configuration with a staging-only JSON document.

## See also

- [`backup-restore.md`](./backup-restore.md) — the R2/Neon reconciliation caveat after a Neon
  restore interacts directly with this cron; read it before disabling or re-enabling the cleanup
  tick around a restore.
- [`pitr-rehearsal.md`](./pitr-rehearsal.md) — the Neon-side counterpart to this file: rehearsing
  point-in-time recovery the same way this file documents rehearsing the storage side's cleanup.
- [`alerting.md`](./alerting.md) — the queue/backlog thresholds that surface *before* an
  under-provisioned cleanup path becomes an incident.
