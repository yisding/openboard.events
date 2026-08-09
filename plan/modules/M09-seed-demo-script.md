# M09 — Seed + demo script

| | |
|---|---|
| **Status** | IN PROGRESS — **steps 1–2 (SeedCtx, `lib/ids.ts`, the eight stub modules and the orchestrator) claimed** by the agent holding M07/M10-step-1, both in review; it is R1 step 5 and its hard deps M03/M04 are merged. Per-feature seed content stays with its own workstream. **MERGED-PARTIAL** typed browser fixtures exist; the wipe/reset flow, per-feature seeds, and judge-script AC do not. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-A Platform & Foundation (architect owns the **orchestrator + helpers + demo script**; each per-feature seed module is owned by that feature's workstream) |
| **Scheduled** | Sat AM (orchestrator + core content, part of CP1) → Sun (v2: feature modules composed) → Tue (v3: matched to the walkthrough videos) |
| **Size** | M (orchestrator + core; feature modules land with their workstreams) |
| **Paths owned** | **Architect:** `scripts/seed/index.ts`, `scripts/seed/lib/ids.ts`, `scripts/seed/lib/helpers.ts`, `scripts/seed/README.md`, `docs/demo-script.md`. **One-time create then transferred:** `scripts/seed/{events,forms,contacts,submissions,evaluation,portal,agenda,comms}.ts` as typed no-op stubs |

## Objective
`pnpm seed` fills a database with a complete, slightly hostile, relative-dated demo world in one idempotent run, so every judged surface renders non-empty within ten minutes of a fresh deploy. `docs/demo-script.md` maps each of the brief's 9 primary features to a URL, a seeded artifact and a 60-second line, and prints the admin login, the **reviewer** login, and a team-owned speaker email for the normal OTP flow. Seed is split into per-feature modules so it is never a merge hotspot.

## Dependencies
- **Hard (blocks start):** [M03](./M03-db-schema-migrations.md) (schema applied to sb-dev), [M04](./M04-shared-libs.md) (**`compileFormSnapshot`** — seed snapshots are never hand-written; plus `sanitize`, `time.ts` for relative dates).
- **Soft (start against stub/fixture):**
  - Every per-feature module is created here as a typed no-op stub with its exact signature and then **owned by its workstream**; the orchestrator composes whatever exists. A missing feature module is a no-op, never a crash.
  - `seedDefaultTemplates(dbOrTx, eventId)` from [M34](./M34-comms-outbox-dispatcher.md) is the **single owner of default template rows** (8 keys, incl. `portal_login`) — the seed calls it and **never hand-writes `email_templates`**. Until [M34](./M34-comms-outbox-dispatcher.md) lands, the comms seed module is a no-op; the templates simply appear Saturday afternoon.
  - Headshot `file_assets` need real R2 objects ([M07](./M07-r2-storage.md)); until then seed rows point at a checked-in placeholder key and the gallery renders the fallback avatar.

## Provides (interfaces others consume)
- `pnpm seed` / `pnpm seed --wipe` — used by every agent, by CI (fresh DB per run), by [M10](./M10-e2e-release.md)'s Playwright fixtures against `sb-test`, and by the post-deploy step on `sb-prod`.
- **Per-feature module contract** (every workstream implements its own file to this signature):
```ts
// scripts/seed/<feature>.ts
export async function seed<Feature>(ctx: SeedCtx): Promise<void>;
export type SeedCtx = {
  tx: TxDb; now: Date;
  eventId: EventId; emptyEventId: EventId;       // the standing empty-state event
  id: (kind: string, key: string) => string;      // UUIDv5 helper — deterministic ids
  log: (msg: string) => void;
};
```
- `scripts/seed/lib/ids.ts` — the UUIDv5 namespace helpers every module must use.
- `docs/demo-script.md` — consumed by judges, by the Wed bug bash, and as the final manual-QA checklist.
- Seeded artifacts consumed by name: `AI.Engineer Sandbox — NYC` event, `Empty Conf` event, form **A** (open) / form **B** (closed), `⚠ Demo conflict A` / `⚠ Demo conflict B` sessions, the overdue task, the seeded reviewer.

## Step-by-step implementation

### 1. CONTRACT-FIRST SLICE — `SeedCtx`, `lib/ids.ts`, and eight stub modules (first 45 minutes)
Create `scripts/seed/lib/ids.ts`:
```ts
export const OPENBOARD_NS = '4f1a5c2e-9b3d-5e7a-8c10-0d2f6b8a1e34';   // fixed, never change
export function seedId(kind: string, key: string): string {           // uuid v5
  return uuidv5(`seed:${kind}:${key}`, OPENBOARD_NS);
}
```
Determinism is what makes re-running a no-op and lets `docs/demo-script.md` hard-code URLs (`/events/<seedId('event','aie-nyc')>/dashboard`). **Every seeded row's id comes from `seedId`; no `gen_random_uuid()` in seed code.**
Create the eight per-feature files exporting the signature above with a `log('skipped — not implemented')` body. Push immediately: each workstream fills its own file with zero merge risk.

**A per-feature seed file with no named owner is a scheduling bug, not a soft spot — the orchestrator no-ops it and four downstream modules render empty.** All eight owners are named in §3 and each is additionally listed in that module's own "Paths owned" row, so the assignment cannot be lost: `events.ts` → [M11](./M11-events-feature.md) · `contacts.ts` → [M17](./M17-abstracts-table.md) (Sat AM, step 2a, **before** `submissions.ts`) · `forms.ts` → [M12](./M12-form-builder-core.md) · `submissions.ts` → [M17](./M17-abstracts-table.md) · `evaluation.ts` → [M19](./M19-evaluation-scoring.md) · `agenda.ts` → [M28](./M28-sessions-crud.md) (Sat AM, Step 1) · `portal.ts` → [M21](./M21-portal-shell.md) (Sat PM) · `comms.ts` → [M34](./M34-comms-outbox-dispatcher.md). ([M26](./M26-resource-pages.md) adds `resources.ts` Monday as a ninth.) If a lane has not pushed its file by its stated slot, escalate at that day's checkpoint — [M32](./M32-public-schedule-gallery.md)'s gallery headshots (a MUST with no fallback), [M38](./M38-dashboard.md)'s Monday build, [M36](./M36-reminder-scan.md)'s CP3 gate item and [M29](./M29-conflict-engine.md)'s named conflict pairs all render against seed data.
- **Done when:** `pnpm seed` runs end-to-end printing eight "skipped" lines and exits 0.

### 2. `scripts/seed/index.ts` — the orchestrator
- Parse `--wipe` (TRUNCATE all tables `RESTART IDENTITY CASCADE` before seeding; without it, upsert).
- Refuse to run against a URL containing the prod project id unless `SEED_ALLOW_PROD=1` (one guard, one line — the Wed "final seed reset" uses it deliberately).
- Open **one** `withTx` for the whole command-line run so a partial seed never lands. This is resolution #4's explicit non-runtime exception; no deployed request or job path may copy it.
- **Insertion order is documented law** (each step depends on ids created by the previous):
  1. `seedEvents` — events, tracks, rooms, formats, tags, users, event_members
  2. `seedContacts` — contacts (+ headshot `file_assets`)
  3. `seedForms` — forms, sections, fields, routing rules, **form_versions via `compileFormSnapshot`**
  4. `seedSubmissions` — submissions, participants, answers, tags (+ `seedEvaluation`: plans, criteria, reviewer assignments, reviews)
  5. `seedAgenda` — sessions, session_speakers
  6. `seedPortal` — portal tasks, file requests, portal forms, completions, responses, uploads, resource pages
  7. `seedComms` — `seedDefaultTemplates(tx, eventId)` (8 rows), reminder rules, communication_logs
- Print a summary table (rows per table) and the credentials block (§6) to stdout.
- **Done when:** `pnpm seed && pnpm seed` twice in a row leaves identical row counts (re-run is a no-op) and the second run prints "0 created, N updated".

### 3. Per-feature seed content — the exhaustive checklist (owners in brackets)
Relative dates anchored to run time so the demo cannot rot.

**`events.ts` [WS-B]** — Event **"AI.Engineer Sandbox — NYC"**, slug `ai-engineer-sandbox-event`, tz `America/Los_Angeles`, `starts_at = now + 65d` 9:00 AM PT, `ends_at = starts + 2d` 5:00 PM PT, theme text with a `18 / 1000`-style short value, `submission_cap_per_user = 3`. Second event **"Empty Conf"** with **nothing** in it (the standing empty-state test). 4 tracks (colored), 5 rooms, 5 formats (Keynote/Talk/Workshop/Panel/Break with default durations), ~6 tags. Users: `organizer@openboard.dev` (owner), `reviewer@openboard.dev` (reviewer), both in `event_members`.

**`contacts.ts` [WS-C]** — **12 speakers**: mixed complete / missing bio / missing headshot (feeds `missing_assets_v` and the dashboard banner), 2 co-speaker pairs, **one speaker on 2 accepted sessions** (task fan-out + speaker-conflict material). Headshot `file_assets` rows backed by **real R2 objects** so the gallery and embeds demo without WS-D. All emails on team-owned inboxes only — never a stranger's address.

**`forms.ts` [WS-B]** — Form **A** open, `closes_at = now + 38d`, limit 3, with **1 conditional field** ("Workshop duration" visible iff Format = Workshop) and **3 routing rules**; Form **B** closed (`closes_at = now − 1d`) to demo the closed state. **Snapshots produced by `compileFormSnapshot`, never hand-written** — the CI seeded-snapshot check zod-parses every one and round-trips it through the [M15](./M15-public-cfp-wizard.md) renderer smoke.

**`submissions.ts` [WS-C]** — **~25 submissions covering all 7 statuses**, including **2 genuine `status='draft'` rows** (real server drafts, so the Drafts tab and the form-card draft counts are real), one row **null in every nullable column** (the R10 probe), and hostile strings: `;lkj`, a 255-char title, emoji, RTL text, and **`<img src=x onerror=alert(1)>` as a title and inside a rich-text description** (the standing XSS probe). Answers written against the pinned snapshot; participants with `is_primary` set correctly.

**`evaluation.ts` [WS-C]** — one plan (round 1, scale 1–5, 3 criteria), **the seeded reviewer user assigned to the plan with a track scope**, partial scores: one submission with 1-of-3 reviews, one with none (Rating renders "—" and sorts last).

**`agenda.ts` [WS-E]** — **~15 sessions** across the event days, mostly `published`, **3 unscheduled** (NULL times → the tray), and **two named conflicting pairs** — `⚠ Demo conflict A` / `⚠ Demo conflict B` (one room clash, one speaker clash) — plus at least one **back-to-back** pair that must **not** be flagged.

**`portal.ts` [WS-D]** — **3 tasks**, one of each mode (manual / form / file_request), one of them **due `now − 2d`** so the overdue list is never empty and the reminder scan has a due row on its first tick; mixed completions; 1 file request; 1–2 portal forms; 2 resource pages, one containing a YouTube `iframe` (the `wide` sanitizer profile) and one containing a `<script>` that must be stripped.

**`comms.ts` [WS-F]** — `seedDefaultTemplates(tx, eventId)` (**never hand-written rows**), reminder rules at −7 / −1 / +1, and a pre-populated `communication_logs` with `sent` / `queued` / `failed` rows so the log UI and the dashboard are not empty on first paint.

- **Done when:** every one of the nine judged surfaces renders non-empty from a cold `pnpm seed --wipe`, and the empty second event renders every designed empty state instead.

### 4. Idempotency mechanics
Every insert is `ON CONFLICT (id) DO UPDATE SET …` on the deterministic `seedId`. Sequences that are not id-keyed (e.g. `events.submission_seq`) are set explicitly to `max(code)` after submissions land, so a post-seed manual "Add Abstract" does not collide on `UNIQUE(event_id, code)`.
- **Done when:** creating a submission through the UI after a seed run succeeds and gets the next SESS number.

### 5. Wipe safety
`--wipe` truncates in FK-safe order (or one `TRUNCATE … CASCADE`), then reseeds. Without `--wipe`, organic judge-created data survives — that is the point: the Wed midday "final seed reset" is `pnpm seed --wipe` on prod, while during judging plain `pnpm seed` refreshes the demo world without destroying what a judge just typed.

### 6. Credentials block (stdout **and** `docs/demo-script.md`)
```
ADMIN     https://<host>/login   organizer@openboard.dev  / <password>
REVIEWER  https://<host>/login   reviewer@openboard.dev   / <password>   ← needed for feature #4
SPEAKER   https://<host>/portal/ai-engineer-sandbox-event/login   speaker@<team-owned-domain>
PREVIEW   if email is disabled: use EMAIL_FALLBACK_UI=1 diagnostics on sb-web-preview only
```
The seed never mints or commits a bearer token. The speaker uses M06b's normal 15-minute
portal-login challenge; production sends it to the team-owned inbox, while the isolated
preview may expose it only through the explicitly enabled fallback diagnostics.

### 7. `docs/demo-script.md`
One row per brief feature: **# · Feature · URL · Seeded artifact · What to show (≤ 1 line, ≤ 60 seconds)**. Cover all nine plus the four bonuses. Include: the **reviewer 60-second scoring walkthrough**, preview-only email-diagnostics instructions, and any honest deviations (e.g. if cut-line #5 fired, "portal submission detail is read-only — deliberate, see README").
This file doubles as the Wed bug-bash checklist and as the judges' unassisted path.
- **Done when:** someone who did not build the feature walks all nine rows on the deployed preview using only this file, in under 15 minutes, without asking a question — including logging in as the **reviewer** and scoring one abstract.

## Acceptance criteria
Catalog AC, verbatim: *every judged surface renders non-empty from seed; every seeded snapshot passes the CI zod-parse + renderer smoke; XSS probe never alerts; re-run is a no-op; reviewer can score from a cold start using only the demo script.*

```bash
pnpm seed --wipe && pnpm seed          # second run: 0 created
pnpm vitest run tests/seed-snapshots.test.ts   # every form_versions.snapshot zod-parses + renders
psql "$DATABASE_URL" -c "select status, count(*) from submissions group by 1"   # all 7 statuses present
psql "$DATABASE_URL" -c "select count(*) from submissions where status='draft'" # 2
open /events/<seedEventId>/dashboard   # no empty widget; /events/<emptyEventId>/dashboard all empty states
open /e/ai-engineer-sandbox-event/speakers   # headshots render from real R2 objects
# XSS probe: open Abstracts, the detail drawer, the public schedule — no alert() anywhere
```

## Guardrails
- **`compileFormSnapshot` is the only snapshot producer** ([M04](./M04-shared-libs.md)). A hand-written snapshot literal in seed code is a review-blocker and would silently drift from the builder's output — which is exactly the bug the shared compiler exists to prevent.
- **`seedDefaultTemplates` is the only writer of default `email_templates`** ([M34](./M34-comms-outbox-dispatcher.md)). One owner for those rows; the seed calls it, [M11](./M11-events-feature.md)'s event-create calls it, nobody else writes them.
- **Contact rows go through `getOrCreateContact`** where practical (resolution #13); seed's direct writes live in `scripts/seed/contacts.ts` only, which is listed in grep #7's "Only allowed in" column alongside `src/features/portal/server/contacts.ts` ([M01](./M01-scaffold-ci-deploy.md) §10) — a seed run would otherwise fail CI.
- **Seeded emails are team-owned inboxes only.** `EMAIL_MODE=log` everywhere except prod; a seeded contact with a stranger's address is an incident, not a bug.
- **Relative dates, always.** No hard-coded 2026 literals outside the event's own start; a demo that rots on Tuesday is worse than no seed.
- **Hostile data is a feature.** The all-nulls row, the 255-char title, `;lkj`, RTL text, emoji and the `<img onerror>` probe must survive every seed revision — they are the standing tests for R10 (nullable render), CSV quoting ([M20](./M20-csv-export.md)) and R9 (XSS).
- **Per-feature file ownership is the anti-merge-hotspot design** (risk #8). Never edit another workstream's seed module; if their data is wrong for your surface, ask them.
- **Timezone edge case:** the event is `America/Los_Angeles` while agents and judges are elsewhere. Seeded session times must be authored via `zonedInputToUtc(local, 'America/Los_Angeles')`, never as bare UTC literals, or the day tabs bin wrong.
- **Empty-state edge case:** "Empty Conf" must stay genuinely empty — no tracks, no forms, no contacts. Every agent clicks through it before shipping a surface.

## If blocked
- **A feature's seed module is missing:** the orchestrator no-ops it. Seed the minimum that surface needs inline in the architect's own module **only** if it blocks CP1 (e.g. one event + one contact), and hand it back.
- **[M07](./M07-r2-storage.md) not ready for real headshots:** point `file_assets.r2_key` at a checked-in placeholder object and mark it TODO; the gallery renders the fallback avatar and the demo still works.
- **[M34](./M34-comms-outbox-dispatcher.md) not ready:** skip the comms module entirely; nothing else depends on it and the templates appear Saturday afternoon.
- **Done early:** write `docs/demo-script.md`'s nine rows against the seeded URLs (they exist deterministically thanks to `seedId`), then start [M10](./M10-e2e-release.md)'s Playwright skeleton — the specs consume exactly these seeded artifacts.
