# M11 — Events feature: CRUD, branding, vocab, settings hub

| | |
|---|---|
| **Status** | IN PROGRESS — settings/forms UI exists in the PR #2/#5 **STACK-DEMO**; event CRUD, vocabulary persistence, auth, default-template integration, and server AC remain a **SERVER-GAP**. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-B · **agent B1 (builder)**. Matches the catalog (PLAN §4 WS-B; §6 "B1: M11 → M12 → M13b → M14") — no executor deviation. B2 never edits any file in this module. |
| **Scheduled** | **Sat AM** (server half, against M03 schema alone — dashed edges on M05a/M06a/M07) → **Sat PM** (UI half). On the Sat-night demo bar: "create/edit an event with branding". |
| **Size** | L (≈1 day) |
| **Paths owned** | `src/features/events/**` (`index.ts`, `server/queries.ts`, `server/mutations.ts`, `server/guards.ts`, `components/**`, `hooks/**`) · `src/app/(admin)/events/page.tsx` · `src/app/(admin)/events/new/page.tsx` · `src/app/(admin)/events/[eventId]/settings/page.tsx` · `src/app/(admin)/events/[eventId]/settings/(details|tracks|rooms|formats|tags)/**` · `src/app/api/internal/events/**` · `scripts/seed/events.ts` · `src/features/events/fixtures.ts` |

Explicitly NOT owned: `src/db/schema/events.ts` (M03/architect), the `(admin)` layout and sidebar chrome (M05a — this module only supplies `<EventSwitcher>` into M05a's declared slot), `src/shared/ui/**` (M05a/M05b), `src/shared/server/r2.ts` (M07), and — inside the settings subtree this module does **not** own wholesale — **`settings/integrations/**` ([M39](./M39-airtable-export.md), WS-F) and `settings/api-keys/**` ([M40](./M40-public-api.md), WS-F)**. Both are sibling route files; the settings hub's tab strip links to them **by path, never by import**, so B1 and WS-F never touch the same file.

## Objective

An organizer can create an event (name, slug, type, website, location, IANA timezone, start/end datetimes, theme) with logo + background images, and manage the event's program vocabulary — Tracks, Rooms, Session Formats, Tags — from a tabbed Settings hub with drag reorder. Creating an event seeds its 8 default email templates (the 7 domain keys plus `portal_login`) and 5 default session formats, so a fresh event is immediately usable by the form builder, agenda, and public pages. Every downstream dropdown in the product (CFP Track/Format/Tags fields, routing-rule targets, evaluation scope, agenda room columns, embed filters) reads its options from this module's queries.

## Dependencies

**Hard (blocks start)**
- **[M03](./M03-db-schema-migrations.md)** — `events`, `tracks`, `rooms`, `session_formats`, `tags`, `file_assets` tables migrated on **sb-dev**, with the composite `UNIQUE (id, event_id)` keys and the slug regex/reserved-word CHECKs live. Drizzle table objects importable from `src/db/schema/events.ts`.
- **[M02](./M02-shared-contracts.md)** — `EventDTO`, `TrackDTO`, `RoomDTO`, `SessionFormatDTO`, `TagDTO`, branded `EventId`/`TrackId`/`RoomId`/`FormatId`/`TagId`, `AppError` codes (`STALE_WRITE`, `VALIDATION`, `NOT_FOUND`).
- **[M04](./M04-shared-libs.md)** — `defineHandler`, `slug.ts` (`slugify` + reserved words), `time.ts` (`zonedInputToUtc`, `formatInZone`), `errors.ts`, `env.ts`.

**Soft (start against stub/fixture)**
- **[M05a](./M05a-admin-shell-ui.md)** admin shell + `DataTable`/`EmptyState`/`ConfirmDialog`/`Dash` — until it lands, build the settings pages with bare `<table>` + shadcn `Button/Input/Select/Tabs` and swap the list bodies to `<DataTable>` in one commit. **Swap step:** replace the three vocab list bodies; delete the local table markup.
- **[M05b](./M05b-rich-ui-primitives.md)** `<DateTimePicker tz>` + `<FileUpload>` — until Sat PM use a plain `<input type="datetime-local">` bound through `zonedInputToUtc(value, event.timezone)` and hide the two image dropzones behind `EventBrandingPanel` returning `null`. **Swap step:** mount `<DateTimePicker tz={event.timezone}>` and `<FileUpload kind="logo"|"background">`.
- **[M06a](./M06a-admin-auth.md)** `requireAdmin(eventId, role?)` — code against the Phase-0 throwing stub; `defineHandler({ auth: adminAuth() })` already takes it. **Swap step:** none (signature is stable); just verify the 403 path once M06a is live.
- **[M07](./M07-r2-storage.md)** `createUpload`/`finalizeUpload` — branding writes only store `logo_file_id`/`background_file_id`; until M07 lands, the settings page shows the dropzones disabled with hint "uploads land Sat PM". **Swap step:** wire `<FileUpload>`'s `onComplete(fileId)` to `PATCH /api/internal/events/[eventId]` with `{logoFileId}`.
- **[M34](./M34-comms-outbox-dispatcher.md)** `seedDefaultTemplates(dbOrTx, eventId)` — Phase-0 signature stub is a no-op. **Swap step:** none in this module; when M34 lands, re-run `pnpm seed --wipe` and assert **8** rows in `email_templates` for the demo event.

## Provides (interfaces others consume)

All exported from the barrel `src/features/events/index.ts` (server-safe) and `index.client.ts` (components). Signatures marked **PROPOSED** are derived here; the names `getEvent`, `getEventBySlug`, `listTracks/Rooms/Formats/Tags`, `<EventSwitcher>`, `<TrackChip>` are verbatim from PLAN §4/M11.

```ts
// server (index.ts)
export function getEvent(eventId: EventId): Promise<EventDTO | null>;
export function getEventBySlug(slug: string): Promise<EventDTO | null>;
export function listEvents(): Promise<EventDTO[]>;                       // PROPOSED — event switcher + /events
export function listTracks(eventId: EventId): Promise<TrackDTO[]>;       // sort_order asc
export function listRooms(eventId: EventId): Promise<RoomDTO[]>;
export function listFormats(eventId: EventId): Promise<SessionFormatDTO[]>;
export function listTags(eventId: EventId): Promise<TagDTO[]>;
export function getEventVocabulary(eventId: EventId): Promise<{         // PROPOSED — one round-trip for builders
  tracks: TrackDTO[]; rooms: RoomDTO[]; formats: SessionFormatDTO[]; tags: TagDTO[];
}>;
export function createEvent(input: CreateEventInput): Promise<EventDTO>;                       // PROPOSED
export function updateEvent(eventId: EventId, patch: UpdateEventInput,
                            expectedUpdatedAt: string): Promise<EventDTO>;                     // PROPOSED, 409 on mismatch
export function saveVocabItem(eventId: EventId, kind: VocabKind, input: VocabInput): Promise<void>;   // PROPOSED
export function deleteVocabItem(eventId: EventId, kind: VocabKind, id: string): Promise<void>;        // PROPOSED
export function reorderVocab(eventId: EventId, kind: VocabKind, orderedIds: string[]): Promise<void>; // PROPOSED
// client (index.client.ts)
export function EventSwitcher(props: { eventId: EventId }): JSX.Element;
export function TrackChip(props: { track: Pick<TrackDTO,'name'|'color'> | null }): JSX.Element;
```

Routes provided: `/events` (list + Create), `/events/[eventId]/settings?tab=details|tracks|rooms|formats|tags`.
API provided: `POST /api/internal/events`, `PATCH /api/internal/events/[eventId]`, `GET|POST /api/internal/events/[eventId]/vocab/[kind]`, `PATCH|DELETE /api/internal/events/[eventId]/vocab/[kind]/[id]`, `POST /api/internal/events/[eventId]/vocab/[kind]/reorder`.

Consumed by:
- [M12](./M12-form-builder-core.md) — `getEventVocabulary` for dropdown option binding (option ids carry `trackId`/`formatId`/`tagId`); `getEvent` for the builder header and event-tz rendering.
- [M13b](./M13b-rules-ui.md) — `listTracks`/`listTags` for the routing-rule "set Track" / "add Tags" pickers.
- [M14](./M14-form-settings-notifications.md) — `getEvent().submissionCapPerUser` for the "Event max: N" chip; `event.timezone` for the Close Date picker.
- [M15](./M15-public-cfp-wizard.md) — `getEventBySlug` for the branded public shell (logo/background/name) and `timezone` for the deadline banner.
- [M17](./M17-abstracts-table.md), [M19](./M19-evaluation-scoring.md) — track/tag chips + evaluation track scope.
- [M28](./M28-sessions-crud.md), [M30](./M30-day-grid-dnd.md), [M31](./M31-agenda-views.md) — rooms (grid columns), formats (default durations), tracks (lanes/colors).
- [M32](./M32-public-schedule-gallery.md), [M33](./M33-embed-shells.md) — branding + track colors.
- [M38](./M38-dashboard.md) — event start for `daysToEvent`; [M40](./M40-public-api.md) — `getEventBySlug` behind `/api/v1/events/[slug]`.

## Step-by-step implementation

### Step 1 — Contract-first slice (do this before anything else)
Files: `src/features/events/index.ts`, `src/features/events/index.client.ts`, `src/features/events/fixtures.ts`.
Create the barrel with **every signature above**, each implemented as `throw new AppError('INTERNAL','M11 not implemented')`, except: `getEvent`, `getEventBySlug`, `listTracks`, `listRooms`, `listFormats`, `listTags`, `getEventVocabulary` — these return the fixture event/vocab from `fixtures.ts` (one event `AI.Engineer Sandbox — NYC`, tz `America/Los_Angeles`, 4 tracks with hex colors, 5 rooms, 5 formats, 6 tags) so WS-B2/C/E compile and render immediately. `<EventSwitcher>` renders the fixture name; `<TrackChip>` renders `—` for `null` (R10).
**Done when:** `pnpm tsc --noEmit` is green and `import { listTracks } from '@/features/events'` resolves from another feature folder without an eslint-boundaries error.

### Step 2 — Read queries against real tables
Files: `src/features/events/server/queries.ts`.
Implement all `list*`/`get*` with Drizzle over `neon-http` `db` (never `withTx` — resolution #4 confines the runtime Pool to 8 named functions, none of them here). Every signature starts with `eventId` except `getEventBySlug`/`listEvents` (token/global lookups that *resolve to* an event, per R4's stated exception). `getEventVocabulary` issues 4 parallel selects. Map rows → DTOs with `z.parse` on the way out. Point the barrel at these; delete the fixture returns but keep `fixtures.ts` (tests + other agents' stubs use it).
**Done when:** `curl -s localhost:3000/api/internal/events/$EVENT_ID/vocab/tracks | jq '.data|length'` prints the seeded track count (4 after `pnpm seed`).

### Step 3 — Event create + update mutations with optimistic concurrency
Files: `src/features/events/server/mutations.ts`, `src/features/events/server/guards.ts`.
- `createEvent`: zod-validate `CreateEventInput` = `{ name (1..200), slug, eventType, websiteUrl?, location?, timezone (IANA), startsAtLocal, endsAtLocal, theme? (≤1000) }`. Slug: `slugify(input.slug ?? input.name)` then assert `^[a-z0-9](-?[a-z0-9])*$` and not in the reserved list (`api, submit, admin, portal, e, embed, assets, app, cal, f, login` — **import `RESERVED_SLUGS` from `@/shared/lib/slug`, never retype it**; the same 11 values are the `events.slug` CHECK in [M03](./M03-db-schema-migrations.md)); let the DB `UNIQUE` be the real arbiter and map `23505` → `AppError('VALIDATION', 'That slug is taken')` on the `slug` field.
- Timezone: validate with `Intl.supportedValuesOf('timeZone').includes(tz)`; convert the two local datetime strings with `zonedInputToUtc(value, tz)` from `time.ts` (**never** `new Date(str)` — CI greps ban date libs outside `time.ts`).
- Reject `endsAt <= startsAt` in zod `.refine()` before hitting the CHECK, so the user sees a field error not a 500.
- After insert (single statement, no transaction): call `seedDefaultTemplates(db, eventId)` — the signature is **`seedDefaultTemplates(dbOrTx: DbOrTx, eventId: EventId)`** ([M02](./M02-shared-contracts.md) §11: `DbOrTx = typeof db | TxDb`), which is what makes passing the neon-http handle legal here without opening another `withTx` path — then insert the **5 default session formats** — Keynote/45, Talk/30, Workshop/90, Panel/45, Break/15 — with `sort_order` 0..4 and `ON CONFLICT DO NOTHING` on `(event_id, name)`. Tracks/rooms/tags start empty on purpose (they drive the designed empty states). `seedDefaultTemplates` is `ON CONFLICT DO NOTHING` inside M34, so re-invoking it is safe; do **not** hand-write `email_templates` rows here (PLAN §3: single owner).
- **Repair path — the create is not atomic, so make it re-runnable (resolution #4 forbids a ninth `withTx` path):** `createEvent` returns only after both default-seeding calls succeed; a failure between the event insert and the seeding surfaces as a 500 with the event **not yet usable**. The retry heals rather than duplicates: on slug `23505`, before mapping to "That slug is taken", check whether the colliding event is a **half-created orphan** (`email_templates` count < 8 or formats count < 5); if so, re-run both idempotent seeding calls against it and return that event. A PGlite failure test injects a throw between the insert and `seedDefaultTemplates`, then asserts the retried `createEvent` with the same input returns the event with exactly 8 templates (incl. `portal_login`) and 5 formats — no event can be handed to a caller without its required defaults.
- `updateEvent(eventId, patch, expectedUpdatedAt)`: guarded `UPDATE events SET … , row_version = row_version + 1, updated_at = now() WHERE id = $1 AND updated_at = $expected` → 0 rows ⇒ `AppError('STALE_WRITE')` (R11).
**Done when:** PGlite/vitest `src/features/events/server/mutations.test.ts` proves: reserved slug rejected, duplicate slug → VALIDATION, `endsAt <= startsAt` → VALIDATION, second `updateEvent` with the first call's `expectedUpdatedAt` → `STALE_WRITE`.

### Step 4 — Vocabulary CRUD + transactional reorder
Files: `src/features/events/server/mutations.ts` (same file), `src/features/events/server/vocab.ts`.
`VocabKind = 'tracks'|'rooms'|'formats'|'tags'`. Per-kind field sets:
| kind | fields | uniqueness |
|---|---|---|
| tracks | `name`, `color` (hex, default `#6366f1`), `description?`, `sortOrder` | `UNIQUE (event_id, name)` |
| rooms | `name`, `capacity?` (int ≥ 0), `sortOrder` | `UNIQUE (event_id, name)` |
| formats | `name`, `defaultDurationMins` (int 5..600, default 30), `sortOrder` | `UNIQUE (event_id, name)` |
| tags | `name` | `UNIQUE (event_id, name)` |
`reorderVocab(eventId, kind, orderedIds)`: renumber the **whole** list 0..n-1 in one statement (`UPDATE … SET sort_order = v.ord FROM (VALUES …) AS v(id, ord) WHERE …`) — no fractional ranks, no interleaved duplicates (form-builder trap #14 applies here too). Delete: FK is `ON DELETE SET NULL` for `submissions.track_id`/`format_id` and `CASCADE` on `submission_tags`; show `<ConfirmDialog>` naming the impact ("N submissions will become Uncategorized"). 23505 → "A track named X already exists".
**Done when:** `curl -XPOST .../vocab/tracks/reorder -d '{"orderedIds":[...]}'` returns 200 and a follow-up `listTracks` returns exactly that order; re-running the same call is a no-op.

### Step 5 — API routes
Files: `src/app/api/internal/events/route.ts`, `.../[eventId]/route.ts`, `.../[eventId]/vocab/[kind]/route.ts`, `.../[eventId]/vocab/[kind]/[id]/route.ts`, `.../[eventId]/vocab/[kind]/reorder/route.ts`.
Every handler is `defineHandler({ auth: adminAuth(), input: zodSchema, handler })` — the guard **factory call** from `@/features/auth`, never the string `'admin'` and never the bare `requireAdmin` ([M04](./M04-shared-libs.md) §8; a string form would make `shared/**` import `features/**`, which is a CI failure). No Server Actions, no ad-hoc `NextResponse.json` bodies. `eventId` comes from the route params through `defineHandler` (an agent cannot forget it). PATCH bodies carry `expectedUpdatedAt`; the wrapper maps `STALE_WRITE` → HTTP 409.
**Done when:** `curl -XPATCH .../api/internal/events/$ID -H 'content-type: application/json' -d '{"name":"x","expectedUpdatedAt":"1970-01-01T00:00:00Z"}'` returns HTTP 409 with `{"error":{"code":"STALE_WRITE"}}`.

### Step 6 — `/events` list + Create Event page
Files: `src/app/(admin)/events/page.tsx`, `src/app/(admin)/events/new/page.tsx`, `src/features/events/components/event-form.tsx`, `event-card.tsx`.
RSC page calls `listEvents()` directly and hydrates as TanStack `initialData`. Card: name, date range formatted with `formatInZone(startsAt, tz, 'day')` (always carries the zone label), slug, "Open" link. `<EmptyState>` when zero events → "Create your first event". Create form is `react-hook-form` + `zodResolver(createEventInputSchema)` from contracts.
**Done when:** creating an event from the UI redirects to `/events/[id]/settings?tab=details` and the new row is visible after a hard refresh.

### Step 7 — Settings hub, Details tab
Files: `src/app/(admin)/events/[eventId]/settings/page.tsx`, `src/features/events/components/settings-shell.tsx`, `details-tab.tsx`, `branding-panel.tsx`.
Tabs (shadcn `<Tabs>` synced to `?tab=`): **Details · Tracks · Rooms · Formats · Tags**. Details fields in this exact order (from the Event Details screenshot): Event Name\*, Event Slug\* (with helper "Used in your public URLs: /submit/{slug}/…"), Event Type (select: Conference/Summit/Workshop/Meetup/Other), Event Website URL, Event Location, Timezone (IANA select, searchable), Starts At\*, Ends At\* (both `<DateTimePicker tz={timezone}>` — renders and parses in event tz, shows the "PDT" label, clearable), Theme (textarea + live `N / 1000` counter using the shared `limits.ts` counter — code points over tag-stripped text, one rule client+server). Below: **Image Settings** — Logo Image ("Recommended: 300 × 300") and Background Image ("Recommended: 1500 × 500"), each `<FileUpload kind>` with preview + Replace. One `Save` button; on 409 show the friendly banner "This event changed since you loaded it — refresh to see the latest" with a Refresh action.
Do **not** build: Exhibitors/Sponsors toggles, Record Settings, Fields/Personas library, Email Themes, Integrations (never-build list).
**Done when:** changing the timezone re-renders both datetime values with the new zone label without changing the stored instants; the theme counter and the server both reject 1001 characters.

### Step 8 — Vocab tabs with drag reorder
Files: `src/features/events/components/vocab-tab.tsx`, `vocab-row-editor.tsx`, `src/features/events/hooks/use-vocab.ts`.
One generic component parameterised by `kind`. Rows are `dnd-kit` `@dnd-kit/sortable` items (drag handle on the left, matching the builder's field cards); on drop, optimistically reorder then `POST …/reorder`, rolling back on error. Inline add row at the bottom ("+ Add track"). Track rows show a color swatch input. `<EmptyState>` per kind with the downstream hint: tracks → "The CFP Track question and routing rules need at least one track."
**Done when:** dragging a room to the top persists across reload; the empty second seeded event ("Empty Conf") renders all four empty states without errors.

### Step 9 — `<EventSwitcher>` + seed module
Files: `src/features/events/components/event-switcher.tsx`, `scripts/seed/events.ts`.
`<EventSwitcher>` is a shadcn `<Popover>`+`<Command>` list of `listEvents()` rendering avatar initials, truncated name, and date range — mounted by M05a into the sidebar slot. `scripts/seed/events.ts` exports `seedEvents(db)` returning `{ eventId, emptyEventId, trackIds, roomIds, formatIds, tagIds }` with UUIDv5 ids from the shared namespace helper; content per PLAN M09: event "AI.Engineer Sandbox — NYC", tz `America/Los_Angeles`, `starts_at = now + 65d`, `ends_at = starts + 2d`, `submission_cap_per_user = 3`, 4 colored tracks, 5 rooms, 5 formats, 6 tags, plus the empty second event with **nothing** in it. Idempotent (`ON CONFLICT (id) DO UPDATE`). Register it with the architect-owned `scripts/seed/index.ts` orchestrator (first in insertion order).
**Done when:** `pnpm seed && pnpm seed` runs twice with no error and no duplicate rows; the returned ids are stable across runs.

## Acceptance criteria

Catalog AC (reconciled): **create event → branded public shell reachable at slug + 8 default templates present** (7 domain keys + `portal_login`); endsAt≤startsAt rejected; vocab feeds every downstream dropdown; concurrent edit → 409 + friendly message.

Verification:
- `pnpm vitest run src/features/events` — mutation guards, slug rules, reorder renumbering.
- `pnpm seed && psql $DATABASE_URL -c "select count(*) from email_templates where event_id='<id>'"` → `8` (once M34 lands; `0` and a TODO note before that).
- `curl -s $PREVIEW/submit/ai-engineer-sandbox-event/<formId> | grep -c 'AI.Engineer Sandbox'` → ≥1 (branded public shell reachable at the slug — the seeded slug is `ai-engineer-sandbox-event`, per [M09](./M09-seed-demo-script.md) §3 and [M06b](./M06b-portal-auth.md)'s verification curl).
- `curl -XPATCH $PREVIEW/api/internal/events/$ID -d '{"endsAtLocal":"...","startsAtLocal":"..."}'` with `ends ≤ starts` → 400 `VALIDATION` naming the `endsAt` field.
- Two-tab test: open Details in two tabs, Save in tab A, Save in tab B → 409 + "changed since you loaded" banner (no silent overwrite).
- Playwright `admin-setup.spec` (M10) step 1: create event → add track/room/format.

## Guardrails

- **Resolution #4** — no `withTx` here. Event create is single statements plus `seedDefaultTemplates`; if that helper needs a tx it takes the `db` client type. Adding any unnamed runtime `withTx` call site is a review-blocker.
- **Resolution #12/#13** — this module never writes `contacts` and never mints tokens.
- **PLAN §3 template ownership** — `email_templates` rows are created **only** by `seedDefaultTemplates`. Grep `INSERT INTO email_templates` must not match this feature.
- **Invariant greps** — no `process.env` (use `getEnv()`), no `date-fns`/`date-fns-tz` import (use `time.ts`), no `dangerouslySetInnerHTML` (the theme field is plain text; if you ever render event copy as HTML, use `<RichTextView>`), no `export const runtime = 'edge'`.
- **R4 event scoping** — every query fn starts with `eventId`; `getEventBySlug` is the one documented exception and must immediately resolve to an id used everywhere downstream.
- **R11** — Details save is optimistic-concurrency; vocab rows are single-owner surfaces and may last-write-wins, but the reorder write is transactional/whole-list.
- **Timezone edges (analysis trap #1, #13)** — the stored instants never change when the timezone select changes; only rendering does. Clearing a required datetime with the `×` must fail Save with a field message, not save `null`. DST: an event spanning Nov 1 must still render "PDT" before and "PST" after — `formatInZone` handles it; never format with a fixed offset.
- **Slug edges (trap #4)** — reserved words rejected client- and server-side; DB unique constraint is the arbiter; renaming the slug after a CFP link is shared is allowed but the Save dialog must warn "existing /submit links will 404".
- **Empty states (trap #10)** — event with no tracks: the settings tab and every consumer must degrade, not crash. The seeded "Empty Conf" event is the standing test; click it before calling this module done.
- **Concurrent vocab delete** — deleting a track referenced by a routing rule leaves the rule dangling; M13b soft-disables such rules. Do not cascade-delete rules from here.
- **Caching** — all admin routes are `force-dynamic`. Never add `revalidate` to a settings page.

## If blocked

- Blocked on M03 (tables not migrated): write `scripts/seed/events.ts` and `src/features/events/fixtures.ts` first, plus the zod input schemas and `mutations.test.ts` cases (PGlite applies the migration itself, so the tests run before sb-dev is ready).
- Blocked on M05a/M05b (UI primitives): finish Steps 2–5 (all server + API) and the vocab reorder tests; UI is the last thing that needs primitives.
- Blocked on M07 (uploads): everything except `branding-panel.tsx`; ship the panel with disabled dropzones and correct copy.
- Never idle: start [M12](./M12-form-builder-core.md) Step 1 (the forms barrel + `getPublicForm` contract slice) — it unblocks B2 and is the critical path.
