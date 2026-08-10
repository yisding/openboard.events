# Backup & restore runbook

Two things in this system need restoring differently: the **Neon Postgres database** (has
built-in point-in-time recovery, no setup required) and **R2 file objects** (no built-in backup
at all — see the caveat at the bottom). Application code is not "backed up" here; a bad deploy
is [`rollback.md`](./rollback.md), not this file.

Before you ever need the Neon section for real, rehearse it: [`pitr-rehearsal.md`](./pitr-rehearsal.md)
runs the exact commands below against the disposable `sb-dev` branch on a schedule, so the first
time this file's commands run against `sb-test`/`sb-prod` is not also the first time anyone has
typed them.

## Neon point-in-time recovery (PITR)

Neon retains WAL history for every branch and lets you query or restore against any point
within the retention window — no snapshot schedule to configure or verify. The retention window
length depends on the Neon plan; check it for the project in question before assuming a given
timestamp is still reachable (Console → the branch → the restore date picker only offers dates
inside the window; the CLI fails closed with a clear error if you ask for something older).

All commands need `NEON_API_KEY` (or a prior `neonctl auth`) and the project's `--project-id`
(`neonctl projects list` if you don't have it memorized). Environment → branch names, from
`docs/provisioning.md` §3:

| Environment | Neon branch |
|---|---|
| local/dev | `sb-dev` |
| preview | `sb-test` |
| production | `sb-prod` |

### 1. Look, before you touch anything

Time-travel query a past state directly — this does not create or change any branch, so it is
always safe to run first:

```bash
neonctl connection-string sb-prod@2026-08-09T14:30:00Z --project-id <id> --pooled
```

Connect with that string (`psql "<connection-string>"`) and run whatever read-only query
confirms the incident window — e.g. `select count(*) from submissions where created_at > ...`.
This is how you find the right timestamp *before* committing to a restore.

### 2. Non-destructive restore: branch first (default choice)

Materialize the past state as a **new** branch, leaving the live branch untouched. Verify there,
then only point the app at it once you're sure:

```bash
neonctl branches create --project-id <id> \
  --parent "sb-prod@2026-08-09T14:30:00Z" \
  --name restore-check-2026-08-09
```

Get its connection string and run the real integrity checks (row counts, spot-check a known
record, run `pnpm db:migrate` against it if the restore point predates a migration you need):

```bash
neonctl connection-string restore-check-2026-08-09 --project-id <id> --pooled
```

To actually cut the app over to this branch instead of `sb-prod`, update the Cloudflare secret
(see `docs/provisioning.md` §6/§9 for full deploy secret list) and redeploy nothing else — no
Worker code changed:

```bash
echo "<pooled connection string>" | pnpm exec wrangler secret put DATABASE_URL --env production
```

Delete the throwaway branch once you're done with it either way — a restored branch is a full
compute + storage branch, not a free artifact:

```bash
neonctl branches delete restore-check-2026-08-09 --project-id <id>
```

### 3. In-place restore (when you're already certain)

Resets an **existing** branch to a past state, in place. `--preserve-under-name` snapshots the
branch's current (pre-restore) state under a new name first, so an in-place restore is itself
undoable — always pass it:

```bash
neonctl branches restore sb-prod "^self@2026-08-09T14:30:00Z" \
  --project-id <id> \
  --preserve-under-name sb-prod-pre-restore-2026-08-09
```

No `DATABASE_URL` secret rotation is needed here — `sb-prod`'s connection string is unchanged,
only the data behind it moved. Restart nothing except what depends on connections being fresh
(Neon's pooled endpoint handles this transparently for new connections).

### 4. Verify

```bash
curl -s https://sb-web.yi-ding.workers.dev/api/health | jq
# db.ok must be true and server_version must return

bash scripts/post-deploy-smoke.sh https://sb-web.yi-ding.workers.dev --strict --production
```

If the restore point predates a migration currently in `drizzle/`, run `pnpm db:migrate`
(exporting the restored branch's **direct**, non-pooled URL as `DATABASE_URL_DIRECT` first) —
migrations are additive-only, so replaying them forward onto an older snapshot is exactly the
supported, safe case, never a conflict.

## R2 file objects — no built-in backup

R2 has no automatic versioning or snapshotting configured in this project (`wrangler.jsonc`'s
`r2_buckets` are plain buckets). The `file_assets` Postgres table is the **only** record of what
should exist in `sb-files`/`sb-files-preview` — restoring Neon to a past point without a
matching R2 state, or vice versa, will disagree with itself. Concretely:

- **Neon restored to before a file was uploaded, R2 object still exists**: harmless — the row
  just doesn't exist yet; `finalizeUpload` will recreate it on the next real upload with a fresh
  `fileId`, and the old orphaned object is exactly what `cleanupOrphans`
  (`src/shared/server/r2.ts`, wired to the daily cleanup cron) is for.
- **Neon restored to after a file was deleted from R2 (or never uploaded), row now points at
  nothing**: `readPublicFile`/`getDownloadUrl` 404 for that file; there is no automated recovery
  path — the bytes are gone unless a human has a copy elsewhere. There is currently no R2
  object-level backup to restore from.
- **The cleanup cron interaction to know about**: after any Neon restore that moves the
  database backward relative to R2's actual contents, an object uploaded (and finalized) *after*
  the restore point but never re-recorded will look, to `cleanupOrphans`'s R2-listing sweep, like
  a staging object with no owning row — because it now has no owning row. If you've just done a
  restore and are not yet sure everything reconciled, disable the cleanup cron tick (comment out
  the `cleanup` job in `workers/jobs/index.ts`'s dispatch list and redeploy the jobs Worker, or
  simply don't run `POST /api/jobs/cleanup` by hand) until you've confirmed R2 and Neon agree
  again — a sweep is a one-way, best-effort delete with no undo of its own.

## After any restore

- [ ] `/api/health` returns `db.ok: true` on the environment you touched.
- [ ] `bash scripts/post-deploy-smoke.sh <url> --strict [--production]` exits 0.
- [ ] Any throwaway verification branch (`restore-check-*`) is deleted.
- [ ] If an in-place restore was used, the `--preserve-under-name` snapshot branch is recorded
      somewhere (its name, at minimum) in case the restore itself needs undoing.
- [ ] R2/Neon reconciliation confirmed before re-enabling the cleanup cron, per the caveat above.
- [ ] Incident and the exact commands run are recorded (`DECISIONS.md` or wherever this project
      tracks operational history).

## See also

- [`pitr-rehearsal.md`](./pitr-rehearsal.md) — rehearse this file's Neon commands against `sb-dev`
  before an incident is the first time they run for real.
- [`rollback.md`](./rollback.md) — the Worker-code counterpart, for a bad deploy rather than bad
  data.
- [`r2-lifecycle.md`](./r2-lifecycle.md) — the R2-side hygiene job this file's R2/Neon
  reconciliation caveat interacts with.
- [`alerting.md`](./alerting.md) — the `/api/health` thresholds (`db.ok`, and the `comms.*` outbox
  fields) that would actually surface an incident before anyone reaches for this file.
