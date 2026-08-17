# Airtable sync

An event organizer connects their own Airtable account from the event's settings, and Openboard
keeps a base in that account in step with the event's programme. This document is two things: a
plain description of the contract an organizer is promised, and the operator runbook for the
people who run this codebase.

## What it is, for an organizer

- **You connect your own Airtable account.** Nobody else's data lands in it, and your token never
  touches anyone else's event.
- **It is one-way.** Openboard writes to Airtable; Airtable is never read back. Anything you type
  into a synced field is overwritten the next time that row changes in Openboard — the connect
  screen says so before you paste a token, and every table's Airtable description repeats it:
  *"Synced from Openboard. Edits here are overwritten on the next sync."*
- **It is idempotent.** A record is matched by a hidden `Openboard ID` column
  (`src/features/airtable/plan.ts`'s `OPENBOARD_ID_FIELD`), never by row position or by name.
  Running the sync twice with nothing changed writes nothing the second time. Reconnecting onto a
  base that already holds your rows updates them in place — it does not duplicate them.
- **Nothing is ever deleted by default.** If a record disappears from Openboard, its Airtable row
  is left alone and counted as an "orphan" on the status card, with a one-click "Remove them"
  action. Automatic deletion (`pruneRemoved`) is an opt-in toggle, off by default, and even when on
  it refuses to delete more than `max(10, 20%)` of a table's tracked rows in one run — see
  "Purge and the mass-delete circuit breaker" below.
- **Disconnecting keeps your base.** Forgetting your token stops syncing; the records already in
  your Airtable base are yours and are not touched.

### What is pushed

Seven tables, in this order (link targets always sync before the tables that link to them):

| Table (Airtable display name) | Openboard source | Notes |
|---|---|---|
| Tracks | `tracks` | |
| Rooms | `rooms` | |
| Formats | `session_formats` | |
| Tags | `tags` | |
| People | `contacts` | Only contacts who are an actual speaker or submission participant — a ticket-buyer contact never appears here. Carries the speaker's headshot in an `Attachment` column. |
| Sessions | `sessions` | Links to Tracks, Rooms, Formats, People. |
| Proposals | `submissions` | Links to Tracks, Formats, People, Tags. |

Every table also carries the hidden `Openboard ID` merge column, and its human-readable primary
field (`Title` for Sessions/Proposals, `Name` for everything else) so linked-record chips read like
a person made them, not like a UUID.

Join tables (`session_speakers`, `submission_participants`, `submission_tags`) are never synced as
their own Airtable tables — they show up as the `multipleRecordLinks` fields above.

### What is *not* pushed, and why

- **Attendee/ticket data, form answers, speaker logistics values, contact unavailability, audit
  and history tables, and every uploaded file except the speaker headshot.** Out of scope for v1;
  none of this is programme data an organizer's Airtable base needs. Slides, submission-answer
  files and file-request uploads are all *private* file kinds served only through a presigned,
  expiring GET, which is a genuinely different problem from the headshot below.
- **`unsubscribed_at` is never exported, under any toggle.** It is CAN-SPAM consent state. A
  marketing team bulk-mailing off a stale copy of it in a spreadsheet is a legal problem, not a
  sync bug, so there is no toggle that can turn this one on.
- **CRM is structurally out of scope**, not just a product decision. `airtable_sync_state.event_id`
  is `NOT NULL` with no organization-scoped sibling column; there is no correct way to anchor an
  organization's CRM data to one "home" event the moment that organization runs a second event.
  Syncing CRM data would need its own migration and its own design, not a toggle here.

### Speaker headshots need no signed-URL machinery

This column was deferred on a premise that turned out to be false, so the reasoning is written
down rather than left as a resolved ticket.

An Airtable attachment cell is written as `[{ url, filename }]`, and **Airtable fetches those
bytes once, at write time, and then serves its own copy from its own storage.** The URL is
therefore not a link Airtable keeps — it only has to resolve during that single fetch. Nothing
about the cell decays when the URL does, so there is no expiry to refresh and no refresh
scheduler to build.

That is decisive here specifically because `headshot` is a **public** file kind
(`KIND_POLICY` in `src/shared/server/r2.ts`): it is served by `/f/{fileId}`, unauthenticated,
with no signature, and immutably — replacing a speaker's photo mints a new file id rather than
rewriting an existing one. So the projected value is
`[{"url": "{APP_BASE_URL}/f/{fileId}", "filename": …}]` and every property the sync engine
already relies on holds unchanged:

- **Stable hash.** The value is a pure function of the file id and filename, so a speaker with an
  unchanged headshot is never re-pushed. That matters more here than for a text column: every
  push of a People row makes Airtable download the photo again.
- **`APP_BASE_URL` is inside the hash.** Moving the deployment to a new origin re-pushes every
  speaker who has one, rather than leaving Airtable holding attachments fetched from a hostname
  that no longer resolves.
- **Only finalized assets are offered.** A row still on its `staging/` key never passed the size
  check and content sniff, and `/f/{fileId}` 404s for it, so the projection skips it until
  finalize moves the object. Handing Airtable a 404 buys a broken attachment chip in a base we do
  not own.
- **Empty means empty.** No headshot, and the gate switched off, both project `[]` — Airtable's
  own spelling of "no attachments" — rather than the SQL `NULL` the other gated columns use.

Private file kinds (slides, submission-answer uploads, file-request uploads) are a different
question and remain out of scope: those genuinely do need a presigned, expiring GET, and pushing
them would put files that an organizer has restricted behind Openboard's access rules into a base
with its own sharing model.

### The "What we sync" drawer

| Toggle | Default | Notes |
|---|---|---|
| Include email addresses | **on** | It is the organizer's own speaker roster in the organizer's own base — the one field a program team actually needs there. Named explicitly in the pre-connect disclosure, and toggleable off. |
| Include bios | **on** | Public program copy, pushed as plain text (HTML stripped). |
| Include headshots | **on** | Same class as bios — public programme copy the event's own speaker page already shows. See the section above for why no signed URL is involved. |
| Include pronouns | **off** | Explicit opt-in, not bundled with the roster basics. |
| Include gender | **off** | Same, plus a retention warning in the drawer copy. |
| Purge removed records | **off** | Not a privacy toggle — listed here because it is the sixth row of the same drawer. See below. |

Flipping any toggle takes effect on the next sync (about 15 minutes on the scheduled cadence, or
immediately with "Sync now") — no manual re-sync or reconnect is needed. The newly included (or
excluded) column changes the row's hashed content, so the change is picked up automatically.

### Purge and the mass-delete circuit breaker

Every sync run counts orphans (Airtable rows whose `Openboard ID` no longer matches any source
row) regardless of the `pruneRemoved` toggle, and the status card always surfaces the count. With
the toggle on, the engine deletes them — unless doing so would remove more than `max(10, 20%)` of
that table's tracked rows in one run, in which case the deletion is held (`purgeHeld` in the run's
stats) and the UI explains the number rather than guessing that the organizer meant it. A bad
number on a status card is recoverable; a mass delete in a base Openboard does not own is not.

### Scopes

A personal access token needs three scopes to connect at all, and gets more capability with two
more:

| Scope | Required | What breaks without it |
|---|---|---|
| `data.records:read` | yes | Can't tell an existing row from a new one — every sync would re-push everything. |
| `data.records:write` | yes | Nothing actually reaches the base. |
| `schema.bases:read` | yes | Can't find the organizer's tables and columns. |
| `schema.bases:write` | optional | Without it, Openboard cannot create or repair tables/fields — the organizer builds them by hand from a generated field list (`manualSchemaInstructions()` in `plan.ts`), which can never drift from what the engine would have written itself, because both read the same constant. |
| `user.email:read` | optional | Only affects whether the connected-account line shows an email or a redacted user id. |

**Airtable does not report a PAT's scopes at all.** `GET /v0/meta/whoami` carries a `scopes` array
for *OAuth access tokens*; for a personal access token — the only kind the connect dialog asks for
— it answers `{ id, email }` and no `scopes` key whatsoever. Verified against the live API with a
token that then went on to create a base and write records. So `AirtableWhoami.scopes` is
`string[] | null`, and `null` means **unknown**, never "none": `assumeUnreportedScopes()` in
`scopes.ts` resolves it optimistically to the full set (minus `user.email:read` when no email came
back, which is the one piece of evidence `whoami` does give). Flattening that absence to `[]` told
every correctly-configured organizer that all three required scopes were missing and refused to
create a base — the feature was unreachable for its only supported credential.

**`data.records:write` and `schema.bases:write` cannot be pre-probed** — Airtable's API has no
"can I write?" check. Even a reported `scopes` array is only a claim; `GET /v0/meta/bases`
succeeding corroborates `schema.bases:read`, but the two write scopes are only provable by writing.
The first real `403` from an actual write is authoritative and produces the identical per-scope
guidance the connect screen would have shown, surfaced as a `blocked` sync run rather than a page
to an operator. That is also what backstops the optimistic assumption above: being wrong costs one
amber run naming the exact missing scope.

**There is no Airtable "list workspaces" endpoint.** Creating a new base asks the organizer to
paste one workspace id (the `wsp…` value from their Airtable URL while looking at a workspace),
with an inline hint explaining where to find it. Picking an *existing* base is the primary,
zero-paste path.

## Operator runbook

### Architecture at a glance

- **Everything about the feature lives in `src/features/airtable/`** — `plan.ts` (table/field
  definitions), `scopes.ts` (scope evaluation + copy), `schemas.ts` (wire contracts), `copy.ts`
  (every user-facing string), and `server/` (client, schema-sync, projection, runs, connection,
  sync engine). It imports only `@/db` and `@/shared/*` — no other feature.
- **The PAT is never a standing secret.** Each connection's token is sealed at rest in
  `airtable_connections.token_ciphertext` via `src/features/airtable/server/secret-payload.ts`
  (HKDF info `"airtable_pat-v1"`, AAD bound to `(eventId, connectionId)`), opened server-side only
  for the duration of a sync or a connect-flow API call, and never rendered back to a client.
- **Idempotency is structural, not a cache.** Every write is
  `PATCH /v0/{baseId}/{tableId}` with `performUpsert: { fieldsToMergeOn: ["Openboard ID"] }`.
  `airtable_sync_state` (the pre-existing content-hash table) is an optimization — losing it costs
  one redundant push, never a duplicate record. The hash records *what* was pushed and not *where*,
  so anything that moves the target drops the state with it: pointing the connection at a different
  base clears every row for the event, and a table whose id changed under us (an organizer renaming
  "Sessions", so `ensureBaseSchema` builds a fresh one) clears that table's rows. Without it the new
  target diffs clean against hashes written for the old one and stays empty while the run reports
  `success` — the only failure this integration can have that shows an organizer nothing at all.
- **The change diff runs in Postgres**, not in the isolate: a `jsonb_build_object` projection is
  hashed with `sha256`, anti-joined against `airtable_sync_state.content_hash`, so only genuinely
  changed rows ever leave the database. Link fields are resolved to Airtable record ids *inside*
  that same SQL by joining `airtable_sync_state` for the linked table — never `typecast: true`,
  which would silently create junk rows in a base Openboard doesn't own.
- **One live run per event**, enforced by a partial unique index
  (`airtable_sync_runs_one_active_idx on (event_id) where status = 'running'`), not a
  check-then-act race. A crashed run's lease (`lease_expires_at`) is reaped by the next tick to
  `failed`/`interrupted` before a fresh run is claimed.
- **`blocked` is a run status distinct from `failed`.** A missing scope, a field that exists with
  the wrong type, a base we can no longer see, or a 422 naming the customer's own values (a
  duplicated `Openboard ID`, a value a column's type refuses) is the organizer's problem to fix —
  it renders amber guidance and does **not** call `captureError`. Only our bug or Airtable's
  outage is `failed` and pages through the normal `errors.recentCount` path.
- **Three capture codes, and they are not interchangeable.** A per-event failure inside a manual
  "Sync now" captures as `feature: "airtable", code: "sync"`
  (`runAirtableSyncForEventIn`'s catch). A per-event failure raised *around* that call inside the
  cron sweep loop captures as `code: "sweep"`. `feature: "jobs", code: "airtable.connections"` is
  narrower than it looks: `settledJobStats` only produces it when the whole sweep throws past the
  per-event loop — `reapExpiredSyncRunsIn` or `claimDueAirtableConnectionsIn` itself failing —
  which is sweep infrastructure, not one organizer's sync. Filtering
  `operational_error_buckets` on `airtable.connections` during a sync incident finds nothing.

### Rate limits and budgets

```text
AIRTABLE_EVENTS_PER_TICK   = 5        events claimed per cron tick
AIRTABLE_WRITES_PER_RUN    = 300      write cap per event per run (30 batches of 10)
AIRTABLE_RUN_BUDGET_MS     = 20_000   one event, cron trigger
AIRTABLE_MANUAL_BUDGET_MS  = 15_000   one event, "Sync now" (inline in the request)
AIRTABLE_SWEEP_BUDGET_MS   = 60_000   whole cron sweep
AIRTABLE_LEASE_MS          = 600_000  10 minutes
AIRTABLE_INTERVAL_MS       = 900_000  15 minutes between an event's scheduled runs
MIN_REQUEST_INTERVAL_MS    = 220      serialized inter-request spacing, per base (5 req/s + headroom)
```

Events sync **sequentially**, never concurrently — N events at once would multiply outbound rate
against shared Cloudflare egress and a shared CPU budget for a latency win a 15-minute cadence
cannot perceive. A run that hits its write cap or budget stops cleanly and reports the exact
remainder (`deferred`); the next tick — or a manual "Sync now" — picks up exactly where it stopped.
An event the sweep claimed but ran out of clock before reaching has its claim handed back
(`next_sync_after = now()`), so a deferred *event* means the next tick rather than a full interval.

The 220ms spacer's state is keyed on the **base id** and lives at module scope, not inside one
client. Airtable's 5 req/s is per base, `airtable_sync_runs_one_active_idx` only makes one run per
*event* true, and nothing stops two events sharing a base — an organizer running two conferences
out of one. A cron tick syncing A while someone clicks "Sync now" on B would otherwise give that
base two independent spacers and twice its allowance. This holds within one isolate; 429 handling
remains the backstop beyond it.

Retries: one retry on `429`/`5xx`/network, only if the wait fits the remaining run budget,
honouring `Retry-After`. `401`/`403` get **zero** retries — a revoked token does not get three
attempts across seven tables every fifteen minutes. A `422` schema error triggers exactly one
re-ensure-and-retry, so an organizer renaming a field in Airtable self-heals in one run. A `422`
that names a *value* or the customer's own records instead (`INVALID_VALUE_FOR_COLUMN`, or an
upsert whose merge key matched two rows because someone duplicated one in their base) is
`data_rejected`: `blocked`, never captured, never retried into a loop, and the run says which of
those two it was.

### Cron wiring

`workers/jobs/dispatch.ts`'s `jobsForScheduledTime` dispatches `"airtable"` at `:05/:20/:35/:50`
UTC (`minute % 15 === 5`) — deliberately staggered off `reminders`' `:00/:15/:30/:45` tick, and
never colliding with `cleanup`'s 09:00 run — **and only when `AIRTABLE_CRON === "1"`**. The flag is
read in the dispatcher itself, before the `WEB_JOBS` RPC is ever called:

- With the flag unset or `"0"`: `"airtable"` never appears in the
  dispatched job list, `WEB_JOBS.runJob("airtable")` is never invoked, no heartbeat is written, and
  `/api/health`'s `jobs.airtableLastSuccessAgeSeconds` correctly stays `null` — a switched-off
  integration must never read as a fresh success.
- The private route (`src/app/worker-jobs/airtable/route.ts` → `runDueAirtableSyncsIn`) has its own
  defense-in-depth check of the same flag and returns `{ airtableSkippedDisabled: 1 }` with zero
  Airtable calls if it is ever reached directly (a hand-curled request bypassing the dispatcher).
- **Manual "Sync now" in the settings panel ignores this flag entirely.** It calls the sync engine
  directly. The flag gates scheduled *cron pressure*, not the feature — manual sync keeps working
  whatever the flag says.

The `airtable` job route itself is a single sweep (`runDueAirtableSyncs()`); the lease-reap that a
second "stale runs" sweep would otherwise do is already folded into that same call (it reaps
globally, not scoped to one event, and reports the count as `airtableReapedRuns`), so there is
nothing left for a second sweep to find.

The daily `cleanup` job additionally runs two Airtable-specific sweeps: pruning
`airtable_sync_runs` history older than 30 days, and deleting abandoned `pending` connections (a
wizard someone closed before picking a base) whose token has sat unused for over 24 hours.

### The scheduled-sync switch

`AIRTABLE_CRON` is `"1"` in every environment (`wrangler.jsonc`'s three env blocks and
`workers/jobs/wrangler.jsonc`'s three env blocks — the two files must always change together in
one deploy). It is the kill switch for scheduled sync: set all six back to `"0"` to pause cron
pressure without touching manual "Sync now". After a deploy that changes the flag, verify
`jobs.airtableLastSuccessAgeSeconds` on `/api/health` after the first live tick and the
`sb-jobs[-preview]` Cron Trigger Past Events, per `docs/runbooks/alerting.md`. A sweep with no
connections due is a successful no-op and still writes the heartbeat, so the age becomes a number
on the first `:05/:20/:35/:50` tick after the flag lands.

To re-verify the write path end-to-end against a real PAT, run `scripts/airtable-acceptance.ts`
by hand: `whoami` → create a scratch base → `ensureBaseSchema` → push a seeded fixture event →
push again and assert **zero** write calls → delete one session and assert exactly **one** delete
call → print a counters-only table → print the scratch base's URL. Airtable exposes no
base-deletion API, so the last step is a printed instruction to delete the base by hand. The
script reads `AIRTABLE_API_KEY` through `getEnv()` and never echoes it; that env var is a
local-only convenience for this script and is rejected by `src/shared/lib/env.ts` in any deployed
environment.

### Health and alerting

`/api/health`'s `jobs.airtableLastSuccessAgeSeconds` follows the same shape as the existing
`outbox`/`reminders`/`cleanup` ages, with one difference worth remembering: `null` is the *correct*
steady state while `AIRTABLE_CRON=0`, not a failure. That holds however the job is reached:
`definePrivateJobRoute` skips the heartbeat when a tick's stats say only that a flag switched the
sweep off (`airtableSkippedDisabled`), so a hand-curled `POST /worker-jobs/airtable` with the flag
off cannot make a switched-off integration read as fresh. See `docs/runbooks/alerting.md` for the
full threshold table. Specific sync failures (not scope/schema/data problems — those are `blocked`
and never capture) reach `errors.recentCount` under `feature: "airtable"` with
`code: "sync"` (manual trigger) or `code: "sweep"` (cron trigger); `code: "airtable.connections"`
means the sweep itself failed before it reached any event.

### Testing

Airtable is never contacted from a test. Every server function that talks to Airtable takes an
injectable `fetchImpl`/`makeClient`; no PAT literal appears in any fixture, and nothing under
`tests/` reads `.dev.vars`. `scripts/airtable-acceptance.ts` is the only thing in this repository
that talks to the real Airtable API, and it is run by hand, never in CI.
