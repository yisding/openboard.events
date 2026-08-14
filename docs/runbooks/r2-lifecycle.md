# R2 lifecycle rules

M07's status note carried an open item since PR #15/#17: an R2 lifecycle rule expiring staging
uploads on `sb-files-preview` and `sb-files`. The original event-first key layout made that rule
unsafe. This runbook owns the versioned layout, compatibility window, deployment reconciliation,
and verification that close the gap.

## What a presigned upload leaves behind

`buildStagingKey` (`src/shared/server/r2.ts`) writes every new presigned-PUT target as:

```
staging/evt_<eventId>/<kind>/<fileId>/<filename>
```

and the published key `finalizeUpload` copies it to, once validated, is:

```
evt_<eventId>/<kind>/<fileId>/<filename>
```

A browser that never completes the PUT, or completes it but never calls finalize, leaves the
staging object behind forever unless something reclaims it. Two things already do, both app-level
and both already deployed:

- **`cleanupOrphanUploads`** deletes a `file_assets` row (and its object) once the row is older
  than the TTL and orphaned by the DB-side predicate.
- **`sweepOrphanStagingObjectsIn`** (the "P3-OPS" sweep in the same file) lists the bucket via the
  S3 API, parses both versioned staging layouts, keeps old keys with no owning `file_assets` row,
  and deletes them.

Both run daily via `cleanupOrphans`, wired to the `cleanup` job at 09:00 UTC
(`workers/jobs/dispatch.ts`). **This is the durable app-level mitigation** — an R2-native lifecycle
rule is additional defense in depth (it survives even if the cron stops ticking, or a future code
path forgets to call the sweep), not a replacement for it.

## Layout transition and safety boundary

R2 object lifecycle rules use the same `PutBucketLifecycleConfiguration` shape as S3: a rule's
`Prefix` filter matches an object key **only when the key begins with that exact string**
(anchored at position 0 — `Prefix: "logs/"` matches `logs/2026-08-09.txt`, never
`app/logs/2026-08-09.txt`). Version 2 therefore hoists `staging/` to the bucket root. Published
objects still start with `evt_`, so the fleet-wide rule cannot match immutable downloads.

The versioned parser continues to accept the legacy event-first layout while in-flight URLs and
live rows are migrated:

```
evt_<eventId>/staging/<kind>/<fileId>/<filename>   # version 1, compatibility only
staging/evt_<eventId>/<kind>/<fileId>/<filename>   # version 2, all new uploads
```

Finalization recognizes both versions, but download authorization recognizes neither: only the
published key is ready to serve. Do not remove version 1 until the migration inventory reports
zero database rows and zero bucket objects after the 15-minute presign window.

### Migration checkpoint

`migrateLegacyStagingIn` runs through the temporary private `r2-migration` job every minute while
compatibility is enabled. Keeping it separate prevents fast migration convergence from multiplying
the unrelated daily cleanup and retention scans. It:

1. reads a bounded batch of version-1 `file_assets` rows;
2. server-side copies each live source to its version-2 key;
3. requires the source and destination size and ETag to match;
4. changes `file_assets.r2_key` with a compare-and-swap, then best-effort deletes the old key; and
5. deletes a missing-source row only after the 15-minute presign window and only when the same
   complete ownership predicate used by normal orphan cleanup says it is unowned.

After the row count reaches zero, the job walks `evt_` objects through the S3 continuation token,
deleting old, unowned version-1 objects. `r2_staging_migration_state` stores that opaque cursor and
advances it with a row-version compare-and-swap, so overlapping cron ticks can repeat safe work but
cannot move inventory backwards. A completed cycle records zero legacy rows, zero legacy objects,
and zero failures. Protected deployments poll that state through `pnpm r2:migration:wait`; a
non-zero or incomplete inventory blocks promotion and leaves dual parsing in place.

The migration never changes a published key. If copying, fingerprinting, or the row CAS fails, the
version-1 row remains finalizable and is retried on the next tick. Rolling application code back to
the preceding compatibility release is also safe: it finalizes the exact staging key stored on the
row, including already-migrated version-2 keys. Do not manually delete version-1 objects or remove
the parser to recover a stalled migration; inspect the checkpoint counters and Worker error logs,
repair the R2/DB cause, and let the idempotent job resume.

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
