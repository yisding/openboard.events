# seed

`pnpm seed` fills a database with the demo world in one idempotent run, so every
surface renders non-empty within ten minutes of a fresh deploy.

All per-feature seed bodies are real — `agenda.ts` seeds the sessions and the two
named conflict pairs (**⚠ Demo conflict A** — same room; **⚠ Demo conflict B** —
same speaker) plus the back-to-back pair that must *not* flag.

```bash
APP_ENV=local pnpm seed            # upsert: organic judge-created data survives
APP_ENV=local pnpm seed --wipe     # TRUNCATE every public table first, then reseed
```

`DATABASE_URL` selects the target, and `APP_ENV` must explicitly classify it as
`local`, `preview`, or `production`; an omitted value is rejected rather than
guessed from Neon's opaque hostname. A production run additionally requires
`SEED_ALLOW_PROD=1` — a deliberate, rarely used override.

The same command uploads every seeded headshot before committing its
`file_assets` rows. `APP_ENV=local` writes to local Wrangler R2 (default bucket
`sb-files-dev`); preview and production write remotely to `sb-files-preview`
and `sb-files` respectively. Every target rejects a mismatched `R2_BUCKET_NAME`
because uploads must land in the bucket bound as `FILES` in `wrangler.jsonc`.
Remote runs therefore require the normal authenticated Wrangler/Cloudflare
setup; an upload failure fails the seed instead of leaving public `/f/{id}` links broken.

## How it is split

`index.ts` is the orchestrator and owns the transaction, the wipe, the ordering,
and the summary. Everything else is a per-feature module:

| Module | Seeds |
|---|---|
| `events.ts` | events, tracks, rooms, formats, tags, users, members, and the empty event |
| `contacts.ts` | 12 speakers and their headshot `file_assets` |
| `forms.ts` | form A (open) and form B (closed), snapshots via `compileFormSnapshot` |
| `submissions.ts` | ~25 submissions across all 7 statuses, plus the null and XSS probes |
| `evaluation.ts` | **Round 1** (1–5, two weighted numeric criteria), all three members assigned — the reviewer scoped to AI Agents and Platforms, the other two to everything — and partial scores; **Round 2 · Blind shortlist** (typed criteria, half-open window, blind), carrying all four assignment states at once |
| `agenda.ts` | ~15 sessions, the named conflict pairs, one back-to-back pair |
| `portal.ts` | three tasks (one overdue), a file request, portal forms |
| `resources.ts` | the three resource pages — both sanitizer probes and the unpublished 404 case |
| `comms.ts` | `seedDefaultTemplates`, reminder rules, a pre-populated log |

`upload-headshots.ts` is not a module: the orchestrator calls it inside the
transaction but before any database write, so a committed `file_assets` row can
never point at an object this run failed to upload.

Each module guards its own re-run: an existing round, scored review, or
organizer-edited page is left exactly as it is, so a non-wipe run tops the
world up rather than reverting somebody's walkthrough.

## The two rules a seed module must not break

1. **Every id comes from `seedId(kind, key)`** — never `gen_random_uuid()`.
   Deterministic ids are what make a re-run an upsert instead of a duplicate, and
   what let `docs/demo-script.md` hard-code URLs.
2. **Author times as local wall-clock in the event zone** with `eventLocal(now, days, "09:00")`.
   A bare UTC literal bins onto the wrong day tab for anyone outside that zone.

Insertion order in `index.ts` is documented law: each step depends on ids the
previous one created. Reordering it is a data bug, not a style choice.
