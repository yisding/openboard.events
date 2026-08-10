# seed

`pnpm seed` fills a database with the demo world in one idempotent run, so every
judged surface renders non-empty within ten minutes of a fresh deploy.

**`agenda.ts` is the last typed no-op.** A run prints its skipped line and seeds
everything else; sessions and the named conflict pairs arrive with M28.

```bash
APP_ENV=local pnpm seed            # upsert: organic judge-created data survives
APP_ENV=local pnpm seed --wipe     # TRUNCATE every public table first, then reseed
```

`DATABASE_URL` selects the target, and `APP_ENV` must explicitly classify it as
`local`, `preview`, or `production`; an omitted value is rejected rather than
guessed from Neon's opaque hostname. A production run additionally requires
`SEED_ALLOW_PROD=1` — that flag exists for the Wednesday final reset and nothing else.

The same command uploads every seeded headshot before committing its
`file_assets` rows. `APP_ENV=local` writes to local Wrangler R2 (default bucket
`sb-files-dev`); preview and production write remotely to `sb-files-preview`
and `sb-files` respectively. Every target rejects a mismatched `R2_BUCKET_NAME`
because uploads must land in the bucket bound as `FILES` in `wrangler.jsonc`.
Remote runs therefore require the normal authenticated Wrangler/Cloudflare
setup; an upload failure fails the seed instead of leaving public `/f/{id}` links broken.

## How it is split

`index.ts` is the orchestrator and owns the transaction, the wipe, the ordering,
and the summary. Everything else is a per-feature module owned by the workstream
that owns the feature:

| Module | Owner | Seeds |
|---|---|---|
| `events.ts` | M11 (WS-B1) | events, tracks, rooms, formats, tags, users, members, and the empty event |
| `contacts.ts` | M17 (WS-C) | 12 speakers and their headshot `file_assets` |
| `forms.ts` | M12 (WS-B1) | form A (open) and form B (closed), snapshots via `compileFormSnapshot` |
| `submissions.ts` | M17 (WS-C) | ~25 submissions across all 7 statuses, plus the null and XSS probes |
| `evaluation.ts` | M19 (WS-C) | Round 1 (1–5, two weighted criteria), both members assigned — the reviewer to two tracks — and partial scores |
| `agenda.ts` | M28 (WS-E) | ~15 sessions, the named conflict pairs, one back-to-back pair |
| `portal.ts` | M21 (WS-D) | three tasks (one overdue), a file request, portal forms, resource pages |
| `comms.ts` | M34 (WS-F) | `seedDefaultTemplates`, reminder rules, a pre-populated log |

A module stays a typed no-op until its owner fills it in. The orchestrator
composes whatever exists, so a missing module prints `skipped — not implemented`
and the run still exits 0.

## The two rules a seed module must not break

1. **Every id comes from `seedId(kind, key)`** — never `gen_random_uuid()`.
   Deterministic ids are what make a re-run an upsert instead of a duplicate, and
   what let `docs/demo-script.md` hard-code URLs.
2. **Author times as local wall-clock in the event zone** with `eventLocal(now, days, "09:00")`.
   A bare UTC literal bins onto the wrong day tab for anyone outside that zone.

Insertion order in `index.ts` is documented law: each step depends on ids the
previous one created. Reordering it is a data bug, not a style choice.
