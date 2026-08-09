# M17 — Abstracts table + detail + manual create

| | |
|---|---|
| **Status** | IN PROGRESS — **the database reads are merged** (#37): `listSubmissions`, `getStatusCounts`, `getSubmissionDetail`, with tabs and rows sharing one WHERE clause and the drawer returning the pinned snapshot. Eleven PGlite cases. Remaining: `updateSubmissionFields`, the three route handlers, `scripts/seed/contacts.ts`/`submissions.ts`, and moving the table components off `useDemo()`. |
| **Workstream / executing agent** | WS-C · Submissions Review (single agent; catalog section WS-C, PLAN §6) |
| **Scheduled** | **Sat AM → Sat PM** (starts the moment CP1 lands: schema + seed + M05a). Sat-night demo bar: "abstracts table shows seeded data with working tabs". |
| **Size** | L (~day) |
| **Paths owned** | `src/features/submissions/index.ts` · `src/features/submissions/index.client.ts` (feature barrels — **M18/M19/M20 append one export line each**; same WS-C agent, sequential, no concurrent writer) · `src/features/submissions/server/queries.ts` · `src/features/submissions/server/filters.ts` · `src/features/submissions/components/**` · `src/features/submissions/hooks/**` · `src/features/submissions/store.ts` · `src/app/(admin)/events/[eventId]/submissions/page.tsx` · `src/app/api/internal/submissions/[eventId]/route.ts` · `src/app/api/internal/submissions/[eventId]/counts/route.ts` · `src/app/api/internal/submissions/[eventId]/[submissionId]/route.ts` · **`scripts/seed/contacts.ts`** (WS-C's, per [M09](./M09-seed-demo-script.md) §3 — shipped **Sat AM as step 2a, before `submissions.ts`**, because every other seed module and four downstream modules depend on the 12 speakers existing) · `scripts/seed/submissions.ts` |

## Objective

Program → Abstracts is fully usable against seeded data with **zero WS-B dependency**: eight status tabs with live counts, a sortable/filterable/searchable DataTable of every submission, an inline status editor, page-local bulk selection, a three-tab detail drawer (Details · Participants · **Answers**), and an "Add Abstract" drawer for organizer-created rows. The Answers tab renders the submitted Q&A from `submission_answers` against the **pinned** `form_versions` snapshot and is extracted as `<SubmissionAnswers>` so [M19](./M19-evaluation-scoring.md)'s reviewer view shows a reviewer exactly what the submitter typed. When real CFP intake starts arriving at CP2 it appears here through the database with no code change.

## Dependencies

**Hard (blocks start):**
- [M03](./M03-db-schema-migrations.md) — `submissions`, `submission_participants`, `submission_answers`, `submission_tags`, `contacts`, `tracks`, `tags`, `form_versions` tables + views `submission_status_counts_v` and `submission_ratings_v` + the `submission_status_guard` trigger, **migrated on `sb-dev`**.
- [M02](./M02-shared-contracts.md) — `SUBMISSION_STATUSES` const array + `submissionStatusSchema`, `SUBMISSION_TRANSITIONS`/`canTransition`, branded ids (`EventId`, `SubmissionId`, `ContactId`, `TrackId`, `TagId`), `SubmissionListRow` DTO, `FormSnapshot`, answer-value union, `AppError` codes.
- [M04](./M04-shared-libs.md) — `defineHandler`, `api-client.ts`, `query-keys.ts`, `errors.ts`, `sanitize()`, `time.ts` (`formatInZone`), `limits.ts` (plaintext length helper).
- [M05a](./M05a-admin-shell-ui.md) — `DataTable`, `StatusBadge`, `EmptyState`, `ConfirmDialog`, `Dash`, `TzTime` from `@/shared/ui/app/*`, plus the `(admin)` layout with the Program → Abstracts nav slot.
- [M06a](./M06a-admin-auth.md) — `requireAdmin(eventId, role?)`.

**Soft (start against stub/fixture):**
- [M18](./M18-submission-mutations-notify.md) — status writes and manual create. Code the drawer/inline editor against the **Phase-0 signature stubs in `@/shared/contracts`** (`createSubmission`, `transitionStatus`); swap to the real `@/features/submissions/server/mutations` import when M18's Sat-PM slice lands (one-line import change; the route handlers M17 owns keep their paths).
- [M07](./M07-r2-storage.md) — file answers. Until `getDownloadUrl()` exists, `<SubmissionAnswers>` renders `filename` + a disabled "Download" button when `files[fileAssetId].href === null`. Swap step: fill `href` in `getSubmissionDetail`'s file map from `getDownloadUrl(fileId)`.
- [M09](./M09-seed-demo-script.md) — orchestrator. M17 **writes its own** `scripts/seed/submissions.ts`; if the orchestrator is not ready, run it standalone (`pnpm tsx scripts/seed/submissions.ts`) using the shared UUIDv5 helpers.
- [M19](./M19-evaluation-scoring.md) — the Rating column reads `submission_ratings_v`; with no seeded reviews it renders `—`. No blocking.

## Provides (interfaces others consume)

```ts
// src/features/submissions/server/queries.ts  (exported via ./index.ts)
export async function listSubmissions(
  eventId: EventId,
  filters: SubmissionFilters,        // zod-parsed; see filters.ts below
): Promise<{ rows: SubmissionListRow[]; total: number; page: number; pageSize: number }>;

export async function getStatusCounts(
  eventId: EventId,
  filters: Omit<SubmissionFilters, 'status' | 'page'>,
): Promise<Record<SubmissionStatus | 'all', number>>;   // single source for tabs AND list

export async function getSubmissionDetail(
  eventId: EventId,
  submissionId: SubmissionId,
): Promise<SubmissionDetailDTO>;      // header + participants + answers + pinned snapshot

export async function updateSubmissionFields(
  eventId: EventId,
  submissionId: SubmissionId,
  patch: SubmissionFieldPatch,        // title/description/track/format/level/language/capacity/times/clientSessionId/tagIds
  expectedRowVersion: number,
): Promise<{ rowVersion: number }>;   // 409 AppError('STALE_WRITE') on mismatch
```

`SubmissionListRow` and `SubmissionDetailDTO` are **imported from `@/shared/contracts/submission.ts`** — [M02](./M02-shared-contracts.md) §4 carries this module's field-for-field column set verbatim (it is the one derived from the actual columns), including `submissionId`, `code: number`, `descriptionPlain`, `formName`, `formatName`, `capacity`, `clientSessionId`. **Do not redeclare either type here**; M17 owns the *query* that fills them, not the shape. `code` is a number everywhere; `formatCode(code)` ([M18](./M18-submission-mutations-notify.md)) is the only renderer of `"SESS-n"`. [M20](./M20-csv-export.md)'s `SUBMISSION_CSV_COLUMNS`, [M27](./M27-speakers-admin.md) and [M40](./M40-public-api.md) all consume the contracts version, so a local copy would break four consumers on the day it drifted.

```tsx
// src/features/submissions/components/submission-answers.tsx (exported via ./index.client.ts)
export type AnswerPanelData = {
  formVersion: number | null;
  snapshot: FormSnapshot | null;
  answers: Array<{ fieldId: string; participantId: string | null; value: AnswerValue }>;
  participants: Array<{ id: string; contactId: string; name: string; role: ParticipantRole; isPrimary: boolean }>;
  files: Record<string, { fileId: string; filename: string; href: string | null }>; // fileAssetId → link
};
export function SubmissionAnswers(props: { data: AnswerPanelData }): JSX.Element;
```

Route handlers (all `defineHandler`, admin auth, eventId from the path — R4):
- `GET  /api/internal/submissions/[eventId]` → `listSubmissions` (filters in query string)
- `GET  /api/internal/submissions/[eventId]/counts` → `getStatusCounts`
- `GET  /api/internal/submissions/[eventId]/[submissionId]` → `getSubmissionDetail`
- `PATCH /api/internal/submissions/[eventId]/[submissionId]` → `updateSubmissionFields`
- `POST /api/internal/submissions/[eventId]` → manual create; **delegates to M18's `createSubmission`** (see guardrails)

DB artifact consumed (not owned): `submission_status_counts_v`, `submission_ratings_v`.

**Consumers:** `<SubmissionAnswers>` → [M19](./M19-evaluation-scoring.md) (reviewer scoring view). `listSubmissions` + `SubmissionFilters` → [M20](./M20-csv-export.md) (export must match the on-screen filtered view). `getSubmissionDetail` → [M27](./M27-speakers-admin.md) (speaker detail's submissions list uses the barrel, not raw tables). Seed rows → every workstream (WS-D portal, WS-E agenda promotion, WS-F dashboard/comms all read seeded submissions).

**PROPOSED (derived, not verbatim in PLAN):** `SubmissionFilters`, `SubmissionFieldPatch`, `AnswerPanelData`, and the `/api/internal/submissions/[eventId]/…` route shapes. The catalog lists `createManual` on M17's interface; per resolution #8 M17 owns **no** insert — `POST /api/internal/submissions/[eventId]` is a route that delegates to [M18](./M18-submission-mutations-notify.md)'s `createSubmission`, and there is no separate `createManual` export. Contracts always win on shapes.

## Step-by-step implementation

1. **Contract-first slice (do this first, ship it inside the first hour).**
   Files: `src/features/submissions/index.ts`, `index.client.ts`, `server/queries.ts`, `server/filters.ts`, `components/submission-answers.tsx`.
   - `index.ts` re-exports `./server/queries` and (as they land) `./server/mutations` (M18), `./evaluation/server/queries` (M19), `./export/csv` (M20). Write the four `export *` lines now, commenting out the three that do not exist yet with a `// M18` / `// M19` / `// M20` marker so the appending module just uncomments.
   - `index.client.ts` exports `SubmissionAnswers`, `AbstractsTable`, `SubmissionDrawer`, `StatusCell`.
   - `filters.ts`: the zod v4 `submissionFiltersSchema` — `{ status?: SubmissionStatus | 'all'; q?: string; trackIds?: TrackId[]; tagIds?: TagId[]; formId?: FormId | 'manual'; planId?: PlanId; sort?: 'title'|'status'|'submittedAt'|'rating'|'notifiedAt'|'code'; dir?: 'asc'|'desc'; page?: number; pageSize?: 25|50|100 }`. Defaults: `status:'all'`, `sort:'submittedAt'`, `dir:'desc'`, `page:1`, `pageSize:25`.
   - `submission-answers.tsx` renders the signature above from a **hand-written fixture** (`src/features/submissions/fixtures.ts` — one snapshot with a text, textarea, dropdown, multiselect, url and file field) before any DB work.
   **Done when:** `pnpm tsc --noEmit` passes and a temporary `/events/[eventId]/submissions` page renders `<SubmissionAnswers data={answerFixture} />` with labelled Q&A pairs.

2a. **Seed module — `scripts/seed/contacts.ts` (WS-C-owned; ship it Sat AM, BEFORE `submissions.ts`).**
   **12 speakers** with deterministic `seedContactId(n)` ids: mixed complete / missing bio / missing headshot (feeds `missing_assets_v` and [M38](./M38-dashboard.md)'s banner), **2 co-speaker pairs**, **one speaker on 2 accepted sessions** (the fan-out + speaker-conflict material), and headshot `file_assets` rows backed by **real R2 objects** so [M32](./M32-public-schedule-gallery.md)'s gallery — a MUST with no fallback — demos without WS-D. All emails on team-owned inboxes only. This is the one seed file allowed to write `contacts` directly ([M01](./M01-scaffold-ci-deploy.md) grep #7 lists it alongside `features/portal/server/contacts.ts`); prefer `getOrCreateContact(tx, eventId, email)` where practical.
   **Done when:** `pnpm tsx scripts/seed/contacts.ts` twice leaves 12 rows, `SELECT count(*) FROM missing_assets_v` is non-zero, and `/e/ai-engineer-sandbox-event/speakers` renders real headshot images.

2. **Seed module — `scripts/seed/submissions.ts`.**
   Deterministic UUIDv5 ids via the orchestrator helpers; contacts referenced by `seedContactId(n)` from step 2a (never a raw contacts INSERT here — resolution #13; call `getOrCreateContact(tx, eventId, email)` if a contact is missing).
   Content: ~25 rows spread over **all 7 statuses** including exactly **2 genuine `draft` rows** (pinned `form_version`, `code` allocated); one **all-nulls row** (null description/track/format/level/language/capacity/times/submitter); hostile strings — a `;lkj` title, a 255-char title, an RTL title, `<img src=x onerror=alert(1)>` inside `description_html` and inside a text answer; one submission with **2 participants** (primary + co-speaker); `submission_answers` rows against the golden FormSnapshot fixture covering every committed field type incl. one `{"t":"file"}` answer; `submission_tags` on 3 rows; `notified_at` set on 2 accepted rows.
   **Done when:** `pnpm tsx scripts/seed/submissions.ts` twice in a row leaves row counts unchanged, and `SELECT status, count(*) FROM submissions GROUP BY 1` shows ≥1 row per status.

3. **`server/queries.ts` — the single source for tabs + list.**
   One Drizzle query builder produces both: `getStatusCounts` = the same `WHERE` (search/track/tag/form) applied over `submission_status_counts_v`-equivalent grouping, `listSubmissions` = that `WHERE` + `status` + order + limit/offset. Joins: `contacts` (submitter email/name), `submission_participants`+`contacts` (speaker chips, aggregated), `tracks` (name+color), `submission_tags`+`tags`, `LEFT JOIN submission_ratings_v r ON r.submission_id = s.id AND r.plan_id = $activePlanId`. Active plan = `SELECT id FROM evaluation_plans WHERE event_id=$1 ORDER BY (status='open') DESC, round ASC LIMIT 1` (nullable; no plan → rating always null). Sort by rating uses `NULLS LAST` in **both** directions.
   **Done when:** a PGlite test asserts `sum(getStatusCounts(...)) === getStatusCounts(...).all` and that `listSubmissions({status:'pending'}).total === counts.pending` for the same filters.

4. **Route handlers.** The four handlers above via `defineHandler({ auth: adminAuth(), input: <zod>, handler })` — the guard **factory call** from `@/features/auth`, never the string `'admin'` ([M04](./M04-shared-libs.md) §8); every one takes `eventId` from the path and passes it first. `PATCH` requires `expectedRowVersion` and maps a 0-row update to `409 STALE_WRITE`.
   **Done when:** `curl -s "$BASE/api/internal/submissions/$EVENT_ID?status=pending&pageSize=5" -b admin.cookie | jq '.data.rows|length'` returns 5 and an unauthenticated call returns 401.

5. **Status tabs.** `components/status-tabs.tsx`: fixed order **All Abstracts · Accepted · Accept Queue · Pending · Decline Queue · Declined · Withdrawn · Drafts**, each with its count from the single `counts` query. Tab writes `?status=` (shallow). Zero-count tabs render `0`, never hide.
   **Done when:** the seeded event shows non-zero counts on ≥5 tabs and the sum of the 7 status tabs equals the All count.

6. **DataTable.** `components/abstracts-table.tsx` using `<DataTable>` (M05a). Default visible columns, in order: **Status** (`<StatusCell>`), **Source** (form `internal_name`, or `Manual`/`Import`), **Title** (link opens drawer), **Description** (plaintext-stripped, truncated 80 chars, `title=` full), **Submitter** (email), **Speaker** (chips, max 3 + "+n"), **Track** (colored chip), **Tags** (chips), **Rating** (1 decimal + `(n)`), **Notified** (`<TzTime>`). Hidden-by-default extras available in the column picker: Code (`SESS-n`), Format, Language, Level, Capacity, Client Session ID, Submitted At, Created At. Every cell uses `<Dash>` for nullables. Toolbar: search input (debounced 300 ms, matches title/description/submitter email), Track filter, Tag filter, Source filter, Sort control, `Columns` popover. Footer: `1 — n of m rows`, pager, `Show: 25|50|100`.
   **Done when:** the hostile seed rows render (no `alert`, no `undefined`, no layout break) and the all-nulls row shows `—` in every nullable cell.

7. **Column show/hide persistence.** `store.ts` — Zustand **ephemeral UI only** plus a `persist` middleware writing `openboard.abstracts.columns.<eventId>` to localStorage. No server state in the store (litmus rule, PLAN §2).
   **Done when:** hiding "Tags", reloading the page, and re-opening keeps Tags hidden; clearing localStorage restores defaults.

8. **Inline status editor.** `components/status-cell.tsx` — clicking the badge opens a shadcn `Popover` (or `Select`) listing exactly the 5 decision states **accepted · accept_queue · pending · decline_queue · declined** (never `draft`/`withdrawn`), current one checked, Cancel/Save. Save calls `POST /api/internal/submissions/[eventId]/transition` (M18) with `{ ids:[id], to, expectedFrom: currentStatus }`. On success invalidate **list and counts together** (`qk('submissions', eventId)` prefix). On `STALE_STATUS` show "changed since you loaded" + refetch.
   **Done when:** changing a Pending row to Accept Queue on the Pending tab makes the row disappear, decrements Pending, increments Accept Queue, and the pager total updates in the same render.

9. **Bulk selection.** Row checkboxes + header select-all that is **page-local only** — the toolbar reads "N selected on this page" (never "all matching"). Bulk bar actions: Change status → same transition endpoint with the id array; Clear selection. Selection resets on tab/filter/page change.
   **Done when:** selecting 2 rows and bulk-moving to Accept Queue produces exactly 2 changed ids and the Accept Queue tab count rises by 2.

10. **Detail drawer.** `components/submission-drawer.tsx` — shadcn `Sheet`, opened from row click, URL-synced via `?submission=<id>` so it is linkable and back-button-safe. Header: `SESS-{code}` · title · `<StatusBadge>` · Source · Submitted `<TzTime>`. Tabs:
    - **Details** — editable: Title (≤255 counter), Status, Description (`<RichTextEditor>` from [M05b](./M05b-rich-ui-primitives.md); until it lands use a plain `<textarea>` posting sanitized HTML), Starts/Ends At (`<DateTimePicker tz={event.timezone}>`; fallback native `datetime-local` interpreted through `zonedInputToUtc`), Capacity, Client ID, Format, Language, Level, Track, Tags. Save sends `expectedRowVersion`.
    - **Participants** — list of `submission_participants`: name, email, role, `Primary` badge, sort order. Read-only in M17 (participant editing is not in scope; co-speakers arrive from the CFP).
    - **Answers** — `<SubmissionAnswers data={detail.answerPanel} />`.
    **Done when:** editing Title in one tab, then saving a stale copy in a second tab, shows the 409 message and does not overwrite.

11. **`<SubmissionAnswers>` real data path.** In `getSubmissionDetail`: load `submissions.form_version` → `form_versions.snapshot` for `(form_id, version)`; zod-parse the snapshot (jsonb is a trust boundary — R2.3); load all `submission_answers` and `submission_participants`; resolve file answers to `{fileId, filename, href}`.
    Rendering rules (write them as code comments too):
    - iterate `snapshot.sections` in order, then `fields` in order; abstract-section answers (`participantId === null`) first, then one group per participant with a `Name — role` heading;
    - label always from the snapshot, never from the live `form_fields` row;
    - value by discriminant: `s` → text (a `richtext` field renders through `<RichTextView>`), `n` → number, `d` → date via `formatInZone` (date-only), `opt` → the option's label from the snapshot (unknown id → `(removed option)` + the raw id), `opts` → chips, `file` → `<a href>` download (or filename + disabled button when `href === null`);
    - a field with no answer → `<Dash/>`; an answer whose `fieldId` is **absent** from the snapshot → a final "Answers to fields no longer on this form" group showing the raw key and value.
    Answer `value` jsonb shapes (discriminated by `t` — do not guess, this is the frozen list):

    | field types | value | rendered as |
    |---|---|---|
    | text, textarea, richtext, email, url | `{"t":"s","v":string}` | text; `richtext` through `<RichTextView>`; `url`/`email` as a link |
    | number *(deferred type)* | `{"t":"n","v":number}` | number |
    | date *(deferred type)* | `{"t":"d","v":"YYYY-MM-DD"}` | `formatInZone` date-only |
    | dropdown, radio | `{"t":"opt","v":optionId}` | the option label from the snapshot |
    | multiselect, checkbox | `{"t":"opts","v":optionId[]}` | chips |
    | file | `{"t":"file","v":fileAssetId}` | download link via `files[fileAssetId]` |

    **Done when:** the seeded submission's Answers tab lists every seeded answer with snapshot labels, including the file answer as a working download link, and the `<img onerror>` answer renders as inert text.

12. **Add Abstract drawer.** `components/add-abstract-drawer.tsx` — fields in screenshot order: **Title\*** (counter `0/255`), **Status** (default `Pending`), **Description** (rich text), **Starts At**, **Ends At**, **Capacity**, **Client ID**, **Format**, **Language**, **Level**, **Track**, **Tags**. Footer Cancel / **Create Abstract**. Posts to `POST /api/internal/submissions/[eventId]`, whose handler calls M18's `createSubmission(eventId, { source:'manual', initialStatus, submitterContactId: null, participants: [], answers: [], enforce: { deadline:false, limit:false }, sendConfirmation:false, fields:{…} })`.
    **Done when:** creating a manual abstract yields a row with the next `SESS-n` code, `source = manual`, status Pending, and it appears on the Pending tab without a reload.

13. **Empty states.** `<EmptyState>` for: zero abstracts overall ("No abstracts yet — share your CFP link or add one manually"), zero rows on a filtered tab ("No abstracts in Decline Queue"), zero search results (with a Clear search action), zero participants, zero answers (draft with nothing filled). Verify all of them on the **empty second event** from the seed.
    **Done when:** switching the event switcher to "Empty Conf" renders designed empty states on every tab with no console errors.

14. **Query keys + one invalidation helper.** `hooks/keys.ts`: `qk('submissions', eventId)` prefix, with `qk('submissions', eventId, 'list', filters)`, `…, 'counts', filters)`, `…, 'detail', submissionId)`. Export **one** `invalidateSubmissions(queryClient, eventId)` that invalidates the whole prefix — every mutation hook in M17/M18/M19 calls exactly this, which is what makes "tabs/counts/list never drift" true rather than aspirational.
    **Done when:** grep shows no `queryClient.invalidateQueries` call in the feature outside `hooks/keys.ts`.

15. **Tests.** `src/features/submissions/server/queries.test.ts` (PGlite): counts-vs-list consistency; rating nulls sort last both directions; search matches submitter email; event scoping (a submission in event B is invisible to event A). `src/features/submissions/components/submission-answers.test.ts` (pure): unknown option id, missing field, file with null href, participant grouping.
    **Done when:** `pnpm vitest run src/features/submissions` is green.

## Acceptance criteria

**Catalog AC (verbatim):** tabs/counts/list never drift (single source, invalidated together); seeded hostile rows render safely; the Answers tab shows every seeded answer with the snapshot's labels incl. a downloadable file answer; row leaving active tab's filter disappears without breaking pager; drawer edit with stale row_version → 409.

Verification:
- `pnpm vitest run src/features/submissions/server/queries.test.ts` — counts/list consistency + scoping.
- `pnpm vitest run src/features/submissions/components/submission-answers.test.ts`.
- `curl -s "$BASE/api/internal/submissions/$EVENT_ID/counts" -b admin.cookie | jq` — sum of the 7 statuses equals `.all`.
- `curl -s -X PATCH "$BASE/api/internal/submissions/$EVENT_ID/$SUB_ID" -b admin.cookie -H 'content-type: application/json' -d '{"expectedRowVersion":1,"title":"x"}'` twice → second returns HTTP 409 with code `STALE_WRITE`.
- Playwright `abstracts-decide.spec` (owned by [M10](./M10-e2e-release.md)) — tab counts, bulk move, Notify stamp.
- Eyeball on the deployed preview: hostile seed rows, all-nulls row, empty second event.

## Guardrails

- **Resolution #8 — one INSERT site.** `INSERT INTO submissions` / `db.insert(submissions)` exists **only** in M18's `server/mutations.ts`. The CI invariant grep fails the build otherwise. M17's manual create and `scripts/seed/submissions.ts` both call `createSubmission`; neither allocates codes itself (`nextSubmissionCode` is M18's).
- **Resolution #13 — contacts writes.** Never `INSERT`/`UPDATE` `contacts` here, including in the seed module. Use `getOrCreateContact` / `updateContactFields`.
- **R4 eventId scoping.** Every query fn starts `(eventId, …)`; every route resolves eventId from the path; no query without an `event_id` predicate.
- **R10 nullable-render.** Draft rows are null in almost every column. Every table cell and detail row goes through `<Dash>`. The all-nulls seed row is the tripwire.
- **R9 XSS.** `description_html` is public attacker-controlled input rendered in the admin panel. Sanitize on write; render only through `<RichTextView>`; table cells render **plaintext-stripped** text, never HTML. Do not add a second `dangerouslySetInnerHTML` site — CI greps for it.
- **R11 optimistic concurrency.** Drawer saves carry `expectedRowVersion`; a stale save must never resurrect a status changed by a bulk action.
- **R2 jsonb is a trust boundary.** zod-parse `form_versions.snapshot` and every `submission_answers.value` on read; a malformed value renders `(unreadable answer)`, never crashes the drawer.
- **Counts drift trap** (analysis trap 1): tabs and list come from one query builder and are invalidated together in every mutation hook. Never compute counts client-side from the current page.
- **Bulk scope trap** (trap 2): selection is page-local, labelled as such; never mutate unseen rows.
- **Pager trap** (trap 17): after a status change the row leaves the active tab immediately; refetch counts + list together so the footer total and page bounds stay consistent (if the current page becomes empty, step back one page).
- **Queue states never leak speaker-side** — that mapping lives in M18's `toPortalStatus`; do not reimplement a second mapping here.
- **Timezone.** All instants render via `formatInZone(value, event.timezone)` / `<TzTime>` with the zone label. No `new Date().toLocaleString()`, no `date-fns` import outside `time.ts` (CI grep).
- **Title limit** is 255 in DB, contracts and UI counter — the counter is not the enforcement.

## If blocked

In priority order, never idle:
1. **M18's Sat-PM slice is the next thing in your own lane** — if M17 is waiting on anything, start `nextSubmissionCode` + `createSubmission` ([M18](./M18-submission-mutations-notify.md) steps 1–4). That slice powers the **Sat-night thin-slice integration** (fixture-snapshot CFP form → B2's real submit route → your `createSubmission` → a row in this table on the deployed preview); it is the highest-value thing WS-C can do on Saturday.
2. If M05a's `DataTable` is late: build the table with a plain `<table>` behind the same props and swap; do not fork a second table primitive.
3. If M03 is late: write `scripts/seed/submissions.ts` and the pure `<SubmissionAnswers>` + filter-schema tests against fixtures.
4. Polish inside M17: column picker, search debounce, empty states, keyboard access on the status popover, `?submission=` deep-link behaviour.
5. **Standing WS-C duty (PLAN §6):** WS-C is the designated **swarm capacity for WS-B from Sun noon**. At the Sun-noon golden-path check, if CP2's spine (build form → public CFP submit → abstract appears → accept + Notify) is red, WS-C pauses evaluation work and takes wizard/pipeline tasks from B2's queue. Keep M17/M18 in a mergeable state at all times so that handover costs nothing.
