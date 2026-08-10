# M12 — Form builder core

| | |
|---|---|
| **Status** | IN REVIEW — **implemented by Codex on branch `agent/m12-form-builder`.** The organizer form list and six-step builder now use authenticated database queries and mutations; default creation, immutable snapshot versions, all eight field types, locked-field and post-submission structural guards, stale-write protection, counts, and reorder behavior are covered by PGlite acceptance tests. `pnpm check` is green locally. Remaining before DONE: PR merge and deployed/browser acceptance; routing-rule authoring and deeper settings/notification behavior remain owned by M13b/M14. |
| **Workstream / executing agent** | WS-B · **agent B1 (builder)**. Matches the catalog (PLAN §4 WS-B; §6 "B1: M11 → M12 → M13b → M14"). **B2 never edits a file listed below**; the two agents meet only at `src/features/forms/index.ts` (created here in Step 1, then frozen) and at the golden `FormSnapshot` fixture. |
| **Scheduled** | **Sat PM: Step 1 only** — the forms barrel + `getPublicForm`/`getPinnedSnapshot`/`getCurrentSnapshot` contract slice (~1 h). That slice is what unblocks B2, and B1's Sat PM is otherwise [M11](./M11-events-feature.md)'s UI half (the Sat-night demo bar item). **Sun AM: builder core + finish.** Sat-night demo bar: "forms list + builder skeleton". CP2 (Sun night) needs a judge-built form with 1 conditional field + 1 routing rule. |
| **Size** | L (≈1 day) |
| **Paths owned** | `src/features/forms/index.ts` (4-line re-export barrel, created Step 1 then frozen) · `src/features/forms/exports.builder.ts` · `src/features/forms/server/builder-queries.ts` · `src/features/forms/server/builder-mutations.ts` · `src/features/forms/server/public-queries.ts` · `src/features/forms/server/guards.ts` · `src/features/forms/components/builder/**` · `src/features/forms/hooks/use-builder.ts` · `src/features/forms/lib/form-open.ts` (stub here, hardened by M14) · `src/app/(admin)/events/[eventId]/forms/page.tsx` · `src/app/(admin)/events/[eventId]/forms/[formId]/page.tsx` · `src/app/api/internal/forms/route.ts` · `src/app/api/internal/forms/[formId]/route.ts` · `src/app/api/internal/forms/[formId]/sections/**` · `src/app/api/internal/forms/[formId]/fields/**` · `scripts/seed/forms.ts` |

Owned by B2, never touched here: `src/features/forms/exports.runtime.ts`, `src/features/forms/runtime/**`, `src/features/forms/server/pipeline.ts`, `server/submit.ts`, `server/draft.ts`, `src/app/(public)/submit/**`, `src/app/api/internal/forms/[formId]/{submit,draft}/**`, `src/shared/lib/conditions.ts`.
Owned by M13b/M14 (same agent B1, sequential): `components/builder/visibility-rule-editor.tsx`, `routing-rules-panel.tsx`, `settings-step.tsx`, `notifications-step.tsx`, `server/routing-mutations.ts`, `server/settings-mutations.ts` — **created as one-line throwing stubs in Step 1 here** so the wizard rail compiles, then implemented in their own modules.

## Objective

An organizer can create a submission form, walk a 6-step builder wizard, configure two sections and their questions across the 8 committed field types, reorder fields by drag, and save — with every save compiling an immutable `form_versions` snapshot through the shared `compileFormSnapshot`. The forms list shows real submissions/drafts counts, open/closed status and close dates. Locked system fields and the post-first-submission structural lock are enforced server-side, not just in the UI. `getPublicForm(eventSlug, formId)` — the payload the entire public runtime (B2) and portal renderer (WS-D) consume — is live and backed by real snapshots.

## Dependencies

**Hard (blocks start)**
- **[M03](./M03-db-schema-migrations.md)** — `forms`, `form_sections`, `form_fields`, `form_versions`, `routing_rules` migrated on **sb-dev**, including `form_fields_key_live_uq` (partial unique on `(form_id,key) WHERE deleted_at IS NULL`) and the composite `(id, event_id)` keys.
- **[M04](./M04-shared-libs.md)** — **`compileFormSnapshot`** (the ONLY snapshot producer), `defineHandler`, `sanitize.ts`, `limits.ts` counter, `errors.ts` (`FORM_LOCKED`, `STALE_WRITE`, `VALIDATION`).
- **[M02](./M02-shared-contracts.md)** — `FormSnapshot`, `FieldType` (8 committed + extensible), `VisibilityRule`/`Condition`, `RoutingRule`, `MapsToTarget` closed allowlist, branded `FormId`/`FieldId`.
- **[M11](./M11-events-feature.md)** — `getEventVocabulary(eventId)` returning tracks/formats/tags (option ids bind to them).

**Soft (start against stub/fixture)**
- **[M05a](./M05a-admin-shell-ui.md)** — `DataTable` is not needed (forms list is cards); `EmptyState`, `ConfirmDialog`, `StatusBadge` are. Until they land, use plain shadcn. **Swap step:** replace the three local helpers.
- **[M05b](./M05b-rich-ui-primitives.md)** `<RichTextEditor>` — the welcome message and section descriptions need it. Until Sat PM, render a `<Textarea>` whose value is passed through `sanitize()` on save (same server path). **Swap step:** one import change in `welcome-step.tsx` and `section-config.tsx`; the stored column is `*_html` either way.
- **[M13a](./M13a-condition-evaluator.md)** — only the builder *preview* needs the evaluator; the field editor stores the rule AST regardless. **Swap step:** M13b wires it.
- **[M34](./M34-comms-outbox-dispatcher.md)** `validateTemplateBody` — used by M14's notifications step, not here.

## Provides (interfaces others consume)

Barrel layout (the anti-merge-conflict device — **do not restructure**):

```ts
// src/features/forms/index.ts  — created in Step 1, then FROZEN (architect-labeled PRs only)
export * from './exports.builder';   // owned by B1
export * from './exports.runtime';   // owned by B2
```

```ts
// src/features/forms/exports.builder.ts  (B1)
export function listForms(eventId: EventId): Promise<FormListRow[]>;              // PLAN §4 name
export function getFormForBuilder(eventId: EventId, formId: FormId): Promise<BuilderForm>;  // PLAN §4 name
export function saveFormStep(eventId: EventId, formId: FormId,
                             step: BuilderStep, patch: unknown,
                             expectedUpdatedAt: string): Promise<{ version: number }>;      // PLAN §4 name
export function getPublicForm(eventSlug: string, formId: FormId): Promise<PublicForm>;      // PLAN §4 name
export function getActiveRoutingRules(eventId: EventId, formId: FormId): Promise<RoutingRule[]>; // PROPOSED — M16 consumes
export function getPinnedSnapshot(eventId: EventId, formId: FormId,
                                  version: number): Promise<FormSnapshot | null>;           // PROPOSED — M16/M17/M41
export function getCurrentSnapshot(eventId: EventId, formId: FormId): Promise<FormSnapshot>; // PROPOSED
export function compileAndPublish(eventId: EventId, formId: FormId): Promise<{ version: number }>;
// PROPOSED — the DB-aware wrapper: read authoring rows -> call M04's PURE compileFormSnapshot(rows)
// -> insert form_versions -> bump forms.current_version. M04 owns the pure half ONLY; this module owns
// the wrapper. Consumed by M24's portal-form saves through the same saveFormStep path.
```

```ts
// PROPOSED shapes (land in src/shared/contracts via an architect-labeled PR before Sat noon freeze)
type FormListRow = { id: FormId; internalName: string; externalTitle: string; status: 'draft'|'open'|'closed';
  kind: 'abstract'|'session'; collectParticipants: boolean; closesAt: string|null; createdAt: string;
  submissionCount: number; draftCount: number; pendingCount: number; currentVersion: number };
type PublicForm = { event: { name: string; slug: string; timezone: string; logoUrl: string|null; backgroundUrl: string|null };
  form: { id: FormId; externalTitle: string; pageHeading: string; showWelcome: boolean; welcomeHtml: string|null;
          collectParticipants: boolean; participantRoles: ParticipantRoleConfig[]; successHtml: string|null;
          autoRedirectToPortal: boolean; closesAt: string|null; effectiveLimit: number };
  snapshot: FormSnapshot; openState: { open: boolean; reason: 'ok'|'not_open_yet'|'closed_by_date'|'closed_by_admin' } };
```

Consumed by:
- [M15](./M15-public-cfp-wizard.md) — `getPublicForm` is the entire public payload (branding + snapshot + openness + limit).
- [M16](./M16-submit-pipeline.md) — `getPinnedSnapshot`, `getCurrentSnapshot`, `getActiveRoutingRules`.
- [M13b](./M13b-rules-ui.md) — `getFormForBuilder` (field list for source-field pickers), field-editor mount points.
- [M14](./M14-form-settings-notifications.md) — `saveFormStep('settings'|'notifications', …)`.
- [M24](./M24-portal-form-builder.md) — reuses the field CRUD components and the same `saveFormStep` engine with `context='portal'`.
- [M17](./M17-abstracts-table.md) / [M19](./M19-evaluation-scoring.md) — `getPinnedSnapshot` supplies the labels for the Answers Q&A panel.
- [M41](./M41-speaker-edit-until-close.md) — `getPinnedSnapshot` for prefilled edit.

## Step-by-step implementation

### Step 1 — Contract-first slice (barrel + stubs + `getPublicForm`)
Files: `src/features/forms/index.ts`, `exports.builder.ts`, `exports.runtime.ts` (empty `export {}` placeholder — B2 fills it), `lib/form-open.ts`, `components/builder/{visibility-rule-editor,routing-rules-panel,settings-step,notifications-step}.tsx` (one-line `throw new Error('M13b/M14')` stubs), `server/routing-mutations.ts` + `server/settings-mutations.ts` (throwing stubs).
Implement in `exports.builder.ts`: all signatures above as throwing stubs **except `getPublicForm`, `getPinnedSnapshot`, `getCurrentSnapshot`**, which read `form_versions.snapshot` for real (seeded form A already has one, produced by `compileFormSnapshot` in `scripts/seed/forms.ts`). `lib/form-open.ts` ships the naive twin now — M14 hardens it:
```ts
export function formOpenState(f: {status:string; opensAt:string|null; closesAt:string|null}, nowIso: string):
  { open: boolean; reason: 'ok'|'not_open_yet'|'closed_by_date'|'closed_by_admin' };
```
**Done when:** `curl -s $PREVIEW/api/internal/forms/<seededFormId>/public | jq '.data.snapshot.version'` returns a number, and B2 can render the seeded snapshot through `<FormFieldRenderer>` without touching any B1 file.

### Step 2 — Form create + default field seeding
Files: `server/builder-mutations.ts`, `server/guards.ts`, `src/app/api/internal/forms/route.ts`.
`createForm(eventId, { internalName, kind, collectParticipants })` inserts `forms` (`context='cfp'`, `status='draft'`, `page_heading='Welcome!'`) plus **two sections** and **the default fields**, then compiles version 1. Exact defaults (from the builder screenshots; `wysiwyg` is stored as field_type `richtext`):

*Section `abstract`* — title "Tell us about your submission", page heading "Submission":
| key | label | type | required | locked | maxChars | options | mapsTo |
|---|---|---|---|---|---|---|---|
| `title` | Title | text | ✅ | **✅** | 255 | — | `submission.title` |
| `description` | Description | richtext | ✅ | — | 5000 | — | `submission.description_html` |
| `format` | Format | dropdown | ✅ | — | — | one per `session_formats` row, `{id, label, formatId}` | `submission.format_id` |
| `tags` | Tags | multiselect | — | — | — | one per `tags` row, `{id, label, tagId}` | — |
| `track` | Track | dropdown | ✅ | — | — | one per `tracks` row, `{id, label, trackId}` | `submission.track_id` |
| `level` | Level | dropdown | — | — | — | Beginner/Intermediate/Advanced (plain) | `submission.level` |

*Section `participant`* — title "Tell us about you", page heading "Participant":
| key | label | type | required | locked | maxChars | mapsTo |
|---|---|---|---|---|---|---|
| `first_name` | First Name | text | ✅ | **✅** | 255 | `contact.first_name` |
| `last_name` | Last Name | text | ✅ | **✅** | 255 | `contact.last_name` |
| `email` | Email | email | ✅ | **✅** | — | `contact.email` |
| `company` | Company | text | — | — | 255 | `contact.company` |
| `job_title` | Job Title | text | — | — | 255 | `contact.job_title` |
| `biography` | Biography | richtext | — | — | 5000 | `contact.bio_html` |

"Mobile Phone" from the screenshots is **omitted** — `phone` is a deferred post-CP4 field type (PLAN §1). If an event has zero tracks/tags, seed the Track/Tags fields with zero options and mark them non-required (a dropdown with zero options is hidden at runtime — trap #13); surface a builder banner "Add tracks in Settings to enable the Track question".
**Done when:** `POST /api/internal/forms` then `GET …/public` shows 2 sections, 12 fields, `snapshot.version === 1`, and the 4 locked fields carry `locked: true`.

### Step 3 — `saveFormStep` + `compileFormSnapshot` versioning
Files: `server/builder-mutations.ts`.
`BuilderStep = 'setup'|'welcome'|'abstract'|'participant'|'settings'|'notifications'`. One mutation for all steps; per-step zod schemas in contracts. Algorithm (single-statement writes on `neon-http`; **no `withTx`** — resolution #4):
1. Guarded `UPDATE forms … WHERE id=$1 AND event_id=$2 AND updated_at=$expectedUpdatedAt` → 0 rows ⇒ `STALE_WRITE` (409, R11).
2. Apply the step's writes (form columns / section columns / field rows).
3. Read the form/section/field rows, call the **pure** `compileFormSnapshot(rows: FormAuthoringRows)` from `@/shared/lib/form-snapshot` ([M04](./M04-shared-libs.md)) — it validates (visibility sources strictly earlier & non-deleted; option ids unique; locked-field invariants) and **throws** on violation — then insert `form_versions(version = current_version + 1, snapshot)` and `UPDATE forms SET current_version = version`. **This whole wrapper is this module's `compileAndPublish(eventId, formId)` in `server/builder-mutations.ts`.** `compileFormSnapshot` takes rows, not ids, and does no DB I/O: it lives in `shared/lib`, which may not import the db client at all (M03's lint rule allows `@/db/client` only in `features/*/server/**`, `src/db/**`, `src/shared/server/**`, `scripts/seed/**`), and it is pure precisely so [M09](./M09-seed-demo-script.md) can call it with no database.
4. Return `{ version }`.
Sanitize on write: `welcome_html`, `success_html`, `form_sections.description_html`, `form_fields.help_text` (plain) — every organizer-authored HTML column goes through `sanitize()` (resolution #2).
**Done when:** two consecutive saves produce `form_versions` rows `n` and `n+1` with `published_at` ascending and `forms.current_version = n+1`; a save whose visibility rule points at a *later* field returns 400 `VALIDATION` with the offending field id and writes **no** version row.

### Step 4 — Field CRUD + the 8 committed types
Files: `server/builder-mutations.ts`, `src/app/api/internal/forms/[formId]/fields/**`, `components/builder/field-card.tsx`, `field-editor-drawer.tsx`, `field-type-picker.tsx`, `options-editor.tsx`.
Committed `FieldType` values: **`text`, `textarea`, `richtext`, `dropdown`, `multiselect`, `email`, `url`, `file`**. `phone`/`number`/`date` exist in the pg enum but must **not** appear in the type picker (deferred COULD). Editor drawer fields: Label\*, Key (auto-slugified from label, editable only while the form has zero versions in use — otherwise read-only), Type, Required toggle, Max chars (text/textarea/richtext only), Help text, Options editor (dropdown/multiselect only: label + optional bind-to Track/Format/Tag select feeding `option.trackId|formatId|tagId`), `mapsTo` select (closed allowlist from contracts; the same target may be used by at most one live field — reject duplicates), and the `<VisibilityRuleEditor>` mount (M13b).
Delete = **soft delete** (`deleted_at = now()`), never a row delete — answers survive (data-model §5.1). Deleting a locked field, or a field referenced as a visibility source by a live field, is rejected with a named message.
**Done when:** a form can be built containing one field of each of the 8 types and `GET …/public` renders all 8 in the snapshot with correct `options`/`maxChars`; `pnpm vitest run src/features/forms/server/guards.test.ts` green.

### Step 5 — Locked-field + structural-lock guards (server-enforced)
Files: `server/guards.ts`.
```ts
export function assertNotLockedField(field, change): void;   // throws AppError('VALIDATION')
export function assertStructuralAllowed(eventId, formId, change): Promise<void>; // throws AppError('FORM_LOCKED')
```
- **Locked fields** (`locked=true`: abstract.title, participant.first_name/last_name/email): reject delete, `required:false`, type change, key change, `mapsTo` change — regardless of form state. Label, help text, max chars, sort order remain editable.
- **Structural lock**: `SELECT 1 FROM submissions WHERE form_id=$1 AND status <> 'draft' LIMIT 1` — if a row exists, reject *structural* changes: add/delete field, change type, add/remove options, change `mapsTo`, change `required`, toggle `collect_participants`, change `kind`. Always editable (never `FORM_LOCKED`): labels, help text, welcome/success/section copy, close date, limits, notification settings, enabling/disabling routing rules, and **reordering within a section**. Error carries a UI-ready message: "This form has submissions. Duplicate it to change its structure." (resolution #3 — both mechanisms compose: snapshots protect in-flight visitors, the lock protects organizers from themselves.)
**Done when:** with the seeded form A (which has non-draft submissions), `curl -XDELETE …/fields/<id>` returns 409 `FORM_LOCKED`, and `curl -XPATCH …/fields/<titleFieldId> -d '{"required":false}'` returns 400 even on a form with zero submissions.

### Step 6 — Drag reorder (transactional renumber)
Files: `components/builder/field-list.tsx`, `src/app/api/internal/forms/[formId]/fields/reorder/route.ts`.
`@dnd-kit/sortable` vertical list per section, 6-dot handle on the left of each field card. On drop: optimistic reorder → `POST …/fields/reorder {sectionId, orderedFieldIds}` → renumber the **entire section** 0..n-1 in one `UPDATE … FROM (VALUES …)` statement → recompile snapshot → invalidate. Rollback + toast on error (trap #14: never fractional ranks).
**Cut-line note (PLAN §8 risk #3):** if this is not working by **Sun noon**, replace the drag handle with ▲/▼ buttons hitting the same endpoint and move on — the golden path does not need drag.
**Done when:** reordering two fields and reloading shows the new order; `select sort_order from form_fields where section_id=… order by sort_order` returns a gap-free 0..n-1 sequence.

### Step 7 — Builder wizard shell
Files: `src/app/(admin)/events/[eventId]/forms/[formId]/page.tsx`, `components/builder/builder-shell.tsx`, `step-rail.tsx`, `setup-step.tsx`, `welcome-step.tsx`, `section-step.tsx`, `section-config.tsx`.
Header: "Edit Session Form / {internalName}" + actions **View Form** (opens `/submit/{eventSlug}/{formId}` in a new tab), **Copy Link** (clipboard + toast), **Save** (primary). Left rail with `?step=` sync and per-step completion checkmarks; **6 steps, no Payments step** (annotated NOT NEEDED — do not render even a placeholder):
1. **Submission Setup** — "Submission type and participants": two radio-cards **Abstracts** / **Sessions** (stored as `forms.kind`; behaviour identical), Participants toggle (`collect_participants`), info banner "You can adjust these choices later by editing this form."
2. **Welcome Screen** — Internal Form Name\* (`N/255` counter), External Form Title\* (`N/255`), Page Heading\* "(15 char max)", "Show message" toggle + `<RichTextEditor>` → `welcome_html`.
3. **Abstract Information** — section config (Section Title\* `N/255`, Page Heading\* 15 max, Description & Instructions rich text) + "Form Questions" panel with "+ Add Field" and the field list + `<RoutingRulesPanel>` mount (M13b).
4. **Participant Information** — same section config + participant-roles panel (checkbox per role: Speaker / Co-speaker / Moderator / Panelist → `forms.participant_roles`). **Min/max counts are on the never-build list — do not render the Min/Max inputs.**
5. **Form Settings** → `<SettingsStep>` (M14).
6. **Notifications** → `<NotificationsStep>` (M14).
Footer: Back / Next; final step's primary is Save. Per-step Save persists partial config; a form stays `status='draft'` until the organizer flips it Open on the list card or in Settings.
**Done when:** navigating the rail changes `?step=` and browser Back returns to the previous step; each step's Save round-trips and bumps the version.

### Step 8 — Forms list
Files: `src/app/(admin)/events/[eventId]/forms/page.tsx`, `components/builder/form-card.tsx`, `server/builder-queries.ts`.
`listForms(eventId)` returns rows with **real counts** from one grouped query: `submissionCount = count(*) FILTER (WHERE status <> 'draft')`, `draftCount = count(*) FILTER (WHERE status = 'draft')`, `pendingCount = count(*) FILTER (WHERE status = 'pending')`. Page: "Submission Forms — Collect abstract, session and participant information for your event"; search input; tabs **All n | Open n | Closed n** (client-side over the fetched list); "+ Add" split button → **Create Form** and **Copy settings only** (deep-copy with id remap is deferred post-CP4 — the copy duplicates form-level columns + sections + fields but is labelled "settings only" and never copies routing rules or visibility rules; if that is confusing, ship Create Form alone). Card: leading pending-count badge, name, status pill (`Open`/`Closed` — derived via `formOpenState`), chips (`Abstracts & Participants` when `collect_participants`), meta line `N submissions · N drafts` + `Closes Sep 15, 2026` (via `formatInZone`), right-aligned `Created …`, `…` menu (Edit, Copy Link, Open/Close, Delete).
**Done when:** the seeded form A card reads `1 submissions · 2 drafts` and those numbers equal the Abstracts page's Drafts tab count for that form (single source, no re-derivation).

### Step 9 — Seed module
File: `scripts/seed/forms.ts`.
`seedForms(db, { eventId, trackIds, formatIds, tagIds })` → form **A** (open, `closes_at = now + 38d`, `submission_limit = 3`, default fields **plus** one conditional field `workshop_duration` (text, visible iff `format` `eq` the Workshop option id) **plus** 3 routing rules) and form **B** (closed, `closes_at = now - 1d`). **Snapshots are produced by calling `compileFormSnapshot` — never hand-written** (PLAN §4/M09; CI asserts every seeded snapshot zod-parses as `FormSnapshot` and round-trips the M15 renderer smoke). Idempotent via UUIDv5 ids. Register with `scripts/seed/index.ts` after `events`, before `submissions`.
**Done when:** `pnpm seed --wipe && pnpm vitest run tests/seed-snapshot.test.ts` green.

## Acceptance criteria

Catalog AC (verbatim): **build a form with all 8 field types; locked Title cannot be deleted/un-required even via curl; save produces a new pinned version; structural edit after seeded submission → FORM_LOCKED; drafts count on the form card matches the Drafts tab.**

Verification:
- `pnpm vitest run src/features/forms/server` — guards (locked fields, structural lock), reorder renumbering, save→version monotonicity.
- `pnpm vitest run tests/integration/form-lock.test.ts` (PGlite) — quality-strategy integration test #6.
- `curl -XDELETE $PREVIEW/api/internal/forms/$FORM_A/fields/$TITLE_FIELD_ID` → 400/409 with `VALIDATION`/`FORM_LOCKED`; `curl -XPATCH … -d '{"required":false}'` on the Title field → 400.
- `psql -c "select version from form_versions where form_id='$F' order by version"` → gap-free sequence, one row per save.
- Playwright `admin-setup.spec` — create event → builder: add a dropdown + conditional field + routing rule → publish → Copy Link works.

## Guardrails

- **Resolution #3 (form integrity)** — every save compiles a snapshot **and** the structural lock applies. Never skip compilation "because nothing structural changed"; the runtime pins versions and a missing version breaks in-flight drafts.
- **`compileFormSnapshot` is the ONLY producer** (PLAN §4/M04) — and it is **pure, taking `FormAuthoringRows`**. This module's `compileAndPublish` is the only DB-aware wrapper around it. Do not build a second serializer for the public payload, the seed, or tests, and do not push a DB-reading signature into `shared/lib` (that would break the boundaries rule and the seed's no-DB path in one move). Grep `snapshot:` in this feature — the only construction site must be the call to the shared compiler.
- **Resolution #4** — no `withTx` in this module. If a step needs multi-statement atomicity, express it as a single statement (`WITH … UPDATE … RETURNING`) or accept the documented ordering (guarded form UPDATE first = the concurrency gate).
- **Resolution #8** — this module contains **zero** submission writes. It may only *count* submissions. Grep `INSERT INTO submissions` must not match anywhere in `features/forms`.
- **Resolution #10** — condition ops are exactly `eq | neq | in | not_in | answered | empty`; the field editor must not offer `contains`. Multi-select "contains option X" is `in` over option ids.
- **Resolution #2** — `sanitize()` on save for every `*_html` column written here; rendering is only ever `<RichTextView>`. CI greps `dangerouslySetInnerHTML`.
- **Never build** (PLAN §1 skip list): Payments step, cross-field character limits, participant-role min/max counts, multiple-drafts toggle, admin-alert recipients, "Copy from…" deep-copy with id remap.
- **Trap #5/#40 (builder edits vs in-flight drafts)** — field ids and option ids are server-generated and immutable; renames are always safe because conditions and routing match ids. Never regenerate an option id on an options-editor save; diff by id and only append/soft-remove.
- **Trap #6 (concurrent builder edits)** — every step Save carries `expectedUpdatedAt`; two tabs racing produce one 409 with "This form changed since you loaded it". Never last-write-wins on the builder.
- **Trap #13 (empty states)** — form with zero custom fields, dropdown with zero options (hide the field at runtime rather than erroring), Closed tab with 0, event with no tracks. Click through the seeded "Empty Conf" event before declaring done.
- **Trap #18 (URL stability)** — the public URL is `/submit/{eventSlug}/{form.id}`; renaming `internal_name` must never change it.
- **File-ownership** — `src/features/forms/index.ts` is frozen after Step 1. If a new export is needed, add it to `exports.builder.ts` (B1) or `exports.runtime.ts` (B2), never to `index.ts`. This is the single rule that keeps B1 and B2 from ever conflicting.

## If blocked

- Blocked on M04's `compileFormSnapshot`: build Steps 2/4/5/8 writing rows only, and stub compilation as `throw new Error('awaiting M04')` behind a feature flag; the guards and list are independently testable and are half the module.
- Blocked on M05b's `<RichTextEditor>`: everything else; rich text ships as `<Textarea>` + `sanitize()` and swaps in one import.
- Blocked on M11's vocabulary: seed the Track/Format/Tags option lists from `scripts/seed/events.ts`'s exported ids directly.
- Never idle: write `scripts/seed/forms.ts`, then start [M13b](./M13b-rules-ui.md) Step 1 (rule-editor components against the M13a evaluator, which is already green from Friday night), then [M14](./M14-form-settings-notifications.md).
