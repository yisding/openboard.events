# R2 lifecycle rules

M07's own status note carries an open item since PR #15/#17: "an R2 lifecycle rule expiring the
`staging/` prefix" on `sb-files-preview`/`sb-files`, filed as a provisioning follow-up because
"the durable fix is a lifecycle rule ... infrastructure, not app code, and not this lane's to
run". This is that follow-up, plus the finding that changes
what "expiring the `staging/` prefix" can actually mean today.

## What a presigned upload leaves behind

`buildStagingKey` (`src/shared/server/r2.ts`) writes every presigned-PUT target as:

```
evt_<eventId>/staging/<kind>/<fileId>/<filename>
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
  S3 API, keeps any key containing `/staging/` older than the TTL with no owning `file_assets`
  row, and deletes it.

Both run daily via `cleanupOrphans`, wired to the `cleanup` job at 09:00 UTC
(`workers/jobs/index.ts`). **This is the durable, already-proven mitigation** — an R2-native
lifecycle rule is additional defense in depth (it survives even if the cron stops ticking, or a
future code path forgets to call the sweep), not a replacement for it.

## The finding: no single static prefix isolates `staging/` today

R2 object lifecycle rules use the same `PutBucketLifecycleConfiguration` shape as S3: a rule's
`Prefix` filter matches an object key **only when the key begins with that exact string**
(anchored at position 0 — `Prefix: "logs/"` matches `logs/2026-08-09.txt`, never
`app/logs/2026-08-09.txt`). Verified directly against this project's key scheme:

- Every object in `sb-files-preview`/`sb-files` — staging **and** published alike — starts with
  `evt_<eventId>/`. `staging` is the *second* path segment, not the first, and `<eventId>` is a
  different string for every event, generated at event-creation time.
- There is therefore no fixed prefix string that a lifecycle rule authored once, today, can match
  against "any event's staging objects." `Prefix: "staging/"` matches **zero objects** in either
  bucket — every key starts with `evt_`, not `staging/`. `Prefix: "evt_"` matches **every**
  object, staging and published, which would silently expire published headshots and attachments
  too.
- A per-event rule (`Prefix: "evt_<id>/staging/"`) is technically valid and does work — see
  "Optional: a per-event rule" below — but it does not scale: it protects only the event it was
  authored for, and provides **zero** protection for any event created afterward until a human
  remembers to add another rule for it. Do not treat a per-event rule as the fleet-wide mitigation
  the roadmap item is asking for.

This is a real gap between what M07's status note assumed ("the `staging/` prefix") and what the
shipped key scheme actually produces. The fix that makes a single, static, fleet-wide rule
possible is a key-scheme change — hoisting the segment so every staging key starts with the
literal bucket-root prefix `staging/`:

```
staging/evt_<eventId>/<kind>/<fileId>/<filename>   ← proposed, not implemented
```

That is a change to `buildStagingKey`, `STAGING_SEGMENT`/the orphan-sweep predicate, and anything
else in `src/shared/server/r2.ts` that parses or asserts the key layout — R2 storage's own owned
path (M07, `src/shared/server/r2.ts`), not this module's. **Flagged here as a scoped
follow-up for that module's owner, not made in this change**: it touches a path any in-flight
presigned URL depends on, and a key-scheme migration for an object-storage module deserves that
module's own review, not a drive-by edit from an unrelated ops task. Once it lands, the rule below
("Recommended: the fleet-wide rule") becomes literally correct with no further change.

## What to actually provision, today

### Recommended: the fleet-wide rule (works once the key-scheme follow-up above lands)

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

### Optional, today: a per-event rule for a specific high-traffic event

Only worth doing for an event under active heavy upload traffic where you want R2-native
insurance *now*, before the key-scheme follow-up lands, and are willing to repeat this per event:

```bash
pnpm exec wrangler r2 bucket lifecycle add sb-files-preview expire-staging-<slug> \
  "evt_<eventId>/staging/" --expire-days 2
```

Delete it once the fleet-wide rule above supersedes it (`wrangler r2 bucket lifecycle remove
sb-files-preview --name expire-staging-<slug>`) so the two don't both need auditing.

### Dashboard steps (either rule above, done by hand)

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
pnpm exec wrangler r2 bucket lifecycle remove sb-files-preview --name expire-staging
```

## Not recommended: incomplete-multipart-upload expiration

`wrangler r2 bucket lifecycle add` also supports `--abort-multipart-days`, which is a real,
bucket-safe, prefix-independent rule (multipart uploads carry their own upload-id state,
independent of the final object key, so this filter has no prefix-anchoring gap). It is *not*
provisioned here because nothing in this codebase performs a multipart upload — `presign` only
ever signs a single-shot PUT (`src/shared/server/r2.ts`) — so the rule would be a permanent no-op
today. Revisit only if a future upload path adopts multipart.

## See also

- [`backup-restore.md`](./backup-restore.md) — the R2/Neon reconciliation caveat after a Neon
  restore interacts directly with this cron; read it before disabling or re-enabling the cleanup
  tick around a restore.
- [`pitr-rehearsal.md`](./pitr-rehearsal.md) — the Neon-side counterpart to this file: rehearsing
  point-in-time recovery the same way this file documents rehearsing the storage side's cleanup.
- [`alerting.md`](./alerting.md) — the queue/backlog thresholds that surface *before* an
  under-provisioned cleanup path becomes an incident.
