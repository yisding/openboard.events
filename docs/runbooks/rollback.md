# Rollback runbook

Two independent things can need rolling back after a deployment: the **Worker code**
(`sb-web*`/`sb-jobs*`) and the **database schema** (Neon, via `drizzle/*.sql`). This runbook
covers the first. For a data problem — bad data written by a bad deploy, not a bad deploy
itself — see [`backup-restore.md`](./backup-restore.md).

**Schema migrations are additive-only** (`DECISIONS.md`, "Migration authorship"; enforced by
this repo's hard rules — an applied migration is never edited, `drizzle-kit push` is banned).
That is what makes a Worker code rollback safe on its own: an older deploy's code always runs
against a database that has *at least* the columns/tables it expects, because nothing is ever
dropped. **Never write or run a "down" migration as part of a rollback.** If a migration itself
introduced bad data (not just bad code), that is a `backup-restore.md` problem, not this one.

## Decide which path

| Situation | Use |
|---|---|
| The current deploy is visibly broken (5xx spike, failed smoke check, bad cron tick) and you need mitigation **now** | **Fast path: `wrangler rollback`** (below) — reverts to a previously uploaded Worker version in seconds, no build, no CI wait |
| You know a specific earlier commit was good and want the *next* deploy (and CI's migration/smoke steps) to reflect it | **Redeploy a known-good SHA** (below) — goes through the same migration → web → jobs → smoke pipeline as a normal release |
| A GitHub Actions run itself is broken (bad token, workflow bug) and you cannot wait for CI | **Fast path**, run locally with `pnpm exec wrangler` |

`wrangler rollback` only swaps which previously-uploaded **code version** is live. It does not
rewrite bindings or re-run migrations, because it activates an existing version rather than
uploading the checked-out configuration. That is exactly what makes it safe to run without CI. If
the bad deploy also shipped a secret/var change the rollback target didn't expect, the fast path
alone will not fix that; use the redeploy-a-known-good-SHA path instead.

## Fast path: `wrangler rollback`

Requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the shell (the same credentials
used by `scripts/deploy-cloudflare.sh`; see `docs/provisioning.md` §5).

### 1. Find the target version

```bash
# Web Worker (production). Swap --env preview for the preview environment.
pnpm exec wrangler deployments list --config wrangler.jsonc --env production

# Jobs Worker — separate wrangler config, separate deployment history.
pnpm exec wrangler deployments list --config workers/jobs/wrangler.jsonc --env production
```

Each lists the 10 most recent *deployments*, with the version id(s) behind each and their
timestamps; use `pnpm exec wrangler versions list --config … --env …` for the full per-version
history. Pick the last version ID known to be good — usually the one immediately before the
current one. (`wrangler rollback` prompts for the message even when `-m` is supplied; add `-y`
when running it non-interactively.)

### 2. Roll back

```bash
# Web
pnpm exec wrangler rollback <version-id> --config wrangler.jsonc --env production \
  -m "rollback: <why, e.g. 500s after deploy abc1234>"

# Jobs (only if the jobs Worker itself was the bad deploy — it changes far less often)
pnpm exec wrangler rollback <version-id> --config workers/jobs/wrangler.jsonc --env production \
  -m "rollback: <why>"
```

During the private-jobs compatibility release, deploy or roll back the web Worker first. A new
jobs Worker automatically falls back to the authenticated public callback when an older web
version has no `JobsEntrypoint`; an old jobs Worker can still call the retained public route on a
new web version. Treat any `transport: "public-fallback"` log as expected only for that rollback
window, then restore matching private-capable versions.

Use `--env preview` against the preview config/URL to rehearse this exact sequence risk-free
before ever touching production — the submission checklist's "rehearsed against production at
least once" item means having actually run this against `sb-web` once, not just read this file.

### 3. Verify

```bash
curl -s https://openboard.events/api/health | jq
# {"ok":true,"service":"sb-web","sha":"<expected-older-sha>","env":"production",...}

bash scripts/post-deploy-smoke.sh https://openboard.events --strict --production
```

Confirm `sha` matches the commit the rolled-back version was built from (the deploy scripts
stamp `NEXT_PUBLIC_BUILD_SHA` at build time — `git log --oneline | grep <sha>` to identify the
commit), and that the smoke script exits 0. Then tail the jobs Worker to confirm the cron is
still ticking authenticated:

```bash
pnpm exec wrangler tail --config workers/jobs/wrangler.jsonc --env production
```

## Redeploy a known-good SHA

This is the path when you want a real, CI-verified deployment (migration → web → jobs → smoke,
the same order `.github/workflows/deploy.yml` runs) rather than a bare code swap — for example
after confirming via `git log`/`git bisect` which commit introduced the regression.

### Preferred: dispatch the Deploy workflow at that ref

```bash
gh workflow run deploy.yml --ref <good-sha-or-tag> -f environment=production
```

`workflow_dispatch` checks out the ref it was dispatched against, so this runs the *entire*
pipeline — including `pnpm db:migrate` — as it existed at that commit. This is safe even though
`main` may have gained additive migrations since: `drizzle-kit migrate` tracks applied
migrations in its own journal table and only ever runs new ones forward, so migrating from an
older checkout is a no-op if nothing new to apply, never a downgrade.

The current migration wrapper deliberately never lowers the database journal's historical
`created_at` high-water mark. That preserves this guarantee for checkouts from before the wrapper
existed: their original future-dated journal entries remain at or below the database high-water
mark and are skipped. Current checkouts verify hashes and use an ephemeral compatibility journal
to place only genuinely pending migrations above that mark.

Watch the run with `gh run watch`, then verify exactly as in the fast path's step 3.

### Manual fallback, if GitHub Actions itself is unavailable

Mirrors `scripts/deploy-cloudflare.sh` and `.github/workflows/deploy.yml` by hand. Run from a
clean, disposable worktree — never against the same checkout another lane may be using:

```bash
git worktree add ../sb-rollback <good-sha-or-tag>
cd ../sb-rollback
pnpm install --frozen-lockfile

export DATABASE_URL_DIRECT='<sb-prod direct Neon URL>'
pnpm db:migrate

export APP_BASE_URL='https://openboard.events'
export R2_ACCOUNT_ID='<cloudflare account id>'
# EMAIL_FROM needs no export — it lives in wrangler.jsonc's production vars and
# deploy-cloudflare.sh only verifies it is present in config.
pnpm deploy:web:production
pnpm deploy:jobs:production

bash scripts/post-deploy-smoke.sh "$APP_BASE_URL" --strict --production
cd -
git worktree remove ../sb-rollback
```

`deploy-cloudflare.sh` hard-fails if `APP_BASE_URL` does not exactly match the expected
production/preview origin, so a copy-paste mistake here fails closed rather than deploying to
the wrong Worker.

## After any rollback

- [ ] `/api/health` reports the expected `sha` and `db.ok: true`.
- [ ] `bash scripts/post-deploy-smoke.sh <url> --strict [--production]` exits 0.
- [ ] `wrangler tail` (or the Cloudflare dashboard) shows an authenticated cron tick within the
      next minute.
- [ ] If the incident also wrote bad data (not just bad code), continue to
      [`backup-restore.md`](./backup-restore.md) — a code rollback does not undo rows already
      written by the bad version.
- [ ] File what actually broke and which command fixed it; the submission checklist wants the
      exact rehearsed command recorded, not just "it worked."
