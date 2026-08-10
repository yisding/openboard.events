# M24 — Portal form builder (admin)

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED (rev. 11 / PR #94)**, no active claim. The rev. 10 blocker is closed: `builder-queries.ts`/`builder-mutations.ts` now accept `context`/`targetType` generically, and this run added the two entry points M12 never built — `deleteFormIn` (FK-RESTRICT precheck, M23-matching copy) and `duplicateFormIn` — wired into `/api/internal/forms/**` (`GET`/`POST` context/targetType, `DELETE`, new `POST .../duplicate`). The actual M24 surface is built: `src/features/portal/form-builder/components/{field-library.ts, portal-forms-page.tsx, portal-form-builder.tsx}` (portal forms list with duplicate/delete, single-page builder with an 8-triple standard-field library filtered by target type, and M14's `NotificationsStep` reused verbatim), mounted at `src/app/events/[eventId]/tasks/forms/**`; 9 new integration tests passing. Remaining before `DONE`: deployed click-through (build/duplicate/delete on the preview), a sidebar/task-admin-page link to the new routes (currently reachable only by direct URL), bundle-size impact, and HTTP-layer proof of the `/duplicate`/`DELETE` routes. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-D agent (`features/portal` — "form builder" sub-area). |
| **Scheduled** | Monday, alongside M23 and M25's form-mode, per WS-D's order (`M23 + M24 + M25 form-mode (Mon)`). This is a **named cut-line entry (§9 #10)**: if the Mon-noon micro-checkpoint (M25's real-snapshot render) misses, this module's UI is cut in favor of 2 seeded portal forms edited only via `pnpm seed`; the runtime (M25) stays intact regardless. |
| **Size** | M |
| **Paths owned** | `src/features/portal/form-builder/components/**`; `src/app/(admin)/events/[eventId]/tasks/forms/page.tsx`, `src/app/(admin)/events/[eventId]/tasks/forms/[formId]/page.tsx`; (append-only: one export block in `src/features/portal/index.ts`) |

## Objective

An organizer-facing single-page builder for `context='portal'` forms (e.g. "Update Your Information"), built entirely on WS-B's shared form engine — this module owns almost no new server logic, only a UI that calls M12's field CRUD and M04's `compileFormSnapshot`. When done, an organizer builds a portal form from a hardcoded standard-field library, saves it, and the compiled snapshot is immediately renderable by M25's task runtime.

## Dependencies

- **Hard (blocks start):** [./M12-form-builder-core.md](./M12-form-builder-core.md) (form builder core — `saveFormStep`, field CRUD components, `compileFormSnapshot` wiring on save). M12 finishes Sunday night, so this module is fully unblocked by Monday AM.
- **Soft:** none — unlike M25, this module does not need `FormFieldRendererProps`/[./M15-public-cfp-wizard.md](./M15-public-cfp-wizard.md) at all; it only *authors* forms (via M12's engine), it never *renders* them. Building portal forms has zero dependency on the CFP wizard being real.

## Provides (interfaces others consume)

- The portal-form builder page itself. No new server functions — this module is UI-only, thin wrapping over [./M12-form-builder-core.md](./M12-form-builder-core.md)'s `saveFormStep`/`getFormForBuilder` (called with `context='portal'` forms) and [./M04-shared-libs.md](./M04-shared-libs.md)'s `compileFormSnapshot` (already wired inside M12's save path — this module does not call it directly).
- Forms saved here (`forms.context='portal'`, `target_type='contact'|'submission'`) are consumed by: [./M23-tasks-admin.md](./M23-tasks-admin.md) (a task's `form_id` picker lists these), [./M25-task-runtime.md](./M25-task-runtime.md) (renders their compiled `form_versions.snapshot` via `<FormFieldRenderer>`).

## Step-by-step implementation

1. **Contract-first slice — the 2 seeded portal forms, before any builder UI.** This module's one real dependent is [M25](./M25-task-runtime.md)'s form mode, and what it needs at the **Mon-noon micro-checkpoint** is *a portal form with a compiled snapshot to render* — not a builder. Shipping the builder first makes that checkpoint depend on both M12's engine (Sun night) and this UI (Mon); shipping the forms first makes it depend on neither.
   Add the two `context='portal'` rows — **profile-update** and **session-info** — to `scripts/seed/portal.ts` ([M21](./M21-portal-shell.md) owns the file; coordinate the one-function append with WS-D, same lane) using the 8-triple standard-field library from Step 5, with snapshots produced by **`compileFormSnapshot`** through M12's save path (never hand-written).
   **Done when:** `pnpm seed` produces 2 portal `form_versions` rows whose snapshots zod-parse as `FormSnapshot`, and M25 can render one end-to-end.

2. **Verify M12's engine is portal-safe.** Confirm `getFormForBuilder(eventId, formId)` and `saveFormStep(eventId, formId, step, patch, expectedUpdatedAt)` accept `context='portal'` forms without CFP-only assumptions (welcome/participant steps, deadline banner) leaking into the portal path. If M12's implementation hardcodes CFP-only UI, file the gap immediately — this module needs the field-CRUD sub-components to be reusable standalone, not the whole 6-step CFP wizard shell. **Done when:** a scratch page renders M12's field-list component against a `context='portal'` form with no CFP-only chrome visible.

3. **Portal forms list** (`app/(admin)/events/[eventId]/tasks/forms/page.tsx`).
   - Reuses `<DataTable>`/card list filtered `forms.context='portal'` — call M12's `listForms(eventId)` with a client-side or query-param filter, no new server fn needed.
   - "+ Add" → creates a new `context='portal'` form via M12's create-form mutation, `target_type` chosen at creation (Contact vs Submission — Group omitted per simplification #1), then routes to the builder.
   - **Done when:** the list shows only portal forms, never CFP forms, and vice versa on M12's own list.

4. **Single-page builder** (`app/(admin)/events/[eventId]/tasks/forms/[formId]/page.tsx`) — **not a wizard**, a deliberate simplification vs. the reference product's 3-step wizard (speaker-portal analysis simplification #3). One page, top-to-bottom:
   - **Setup** fields at top: internal Name*, public Title*, target type shown read-only after creation.
   - **Questions** in the middle: sections + fields, reusing M12's field-list CRUD components verbatim.
   - **Settings** collapsed at the bottom: confirmation-email toggle + rich-text body, reusing M14's settings sub-components where they're generic enough — `send_confirmation`/`confirmation_body_html` are plain `forms` columns shared by both CFP and portal forms.
   - One **Save** button — no per-step save, in contrast to M12's CFP wizard.
   - **Done when:** editing a portal form's fields and settings in one visit and clicking Save persists all sections in one `saveFormStep`-equivalent call (or three sequential calls to M12's existing per-step save fns triggered together — pick whichever M12 actually exposes; do not invent a new server endpoint here).

5. **Standard-field library** (hardcoded, exactly 8 triples — do not expand this list, it is a deliberate scope cut per PLAN.md M24):

   | Label | field_type (DB enum) | maps_to | target_type |
   |---|---|---|---|
   | Bio | `richtext` | `contact.bio_html` | contact |
   | Headshot | `file` | `contact.headshot_file_id` | contact |
   | Pronouns | `text` | `contact.pronouns` | contact |
   | Company | `text` | `contact.company` | contact |
   | Job Title | `text` | `contact.job_title` | contact |
   | Session Title | `text` | `submission.title` | submission |
   | Session Description | `richtext` | `submission.description_html` | submission |
   | Session Level | `dropdown` | `submission.level` | submission (options are admin-authored plain labels — `level` is free-text vocab, not an FK, so no `trackId`/`formatId`/`tagId` on its options) |

   **Naming gotcha — flag this explicitly, it is a real cross-doc inconsistency:** PLAN.md's prose calls this committed type "wysiwyg"; the DDL `field_type` pg enum value is `richtext`. Use the DB enum value `richtext` for the actual field row; label it "Rich Text" in the UI. Do not invent a separate `'wysiwyg'` enum value — it does not exist in `form_fields.field_type`.

   "Add Field" popover shows this library (searchable, type-chip per row per screenshot 6) plus a **"Create Field"** option that opens M12's generic custom-field form (no `maps_to`, answers land in `form_responses.answers` jsonb only — no write-back). Only fields whose `target_type` matches the form's `target_type` are offered. **Done when:** adding "Bio" to a `target_type='contact'` form and saving produces a `form_fields` row with `maps_to='contact.bio_html'`; the same library item is hidden when building a `target_type='submission'` form.

6. **No conditional logic on portal forms.** The visibility-rule editor (M13b) is a CFP-only concern — do not surface it in this builder at all (not even disabled); portal forms simply never set `form_fields.visibility` (stays `NULL` = always visible). **Done when:** the portal builder's field editor has no visibility/routing UI whatsoever.

7. **Duplicate / Delete.**
   - Reuse M12's "duplicate settings only" copy mutation and delete mutation as-is — both are generic, not CFP-specific.
   - Delete is blocked by the same `ON DELETE RESTRICT` guard M23 surfaces if a task references the form — M23 owns that error copy, this module just lets the FK violation propagate as a typed error rather than swallowing or re-wrapping it differently.
   - **Done when:** duplicating a portal form produces an independent draft copy with a new id; deleting a form referenced by an active task shows M23's "revert task to manual first" message (shared error code, not a duplicated copy of the string).

8. **Concurrent-edit safety.** Two admin tabs editing the same portal form is possible (analysis edge case #19) — rely on M12's existing optimistic-concurrency (`row_version`/`updatedAt`) save guard rather than building a second one here; a 409 on this page should show the same "changed since you loaded — refresh" pattern M12's CFP builder already uses. **Done when:** saving from a stale-loaded tab returns 409, not a silent overwrite.

## Acceptance criteria

Copied verbatim from the catalog (PLAN.md §4, M24), plus verification commands:

- Build an "Update Your Information" form from library fields — manual click-through on the deployed preview using the seed's 2 portal forms as a starting reference (M09).
- Snapshot compiles via the shared compiler — `pnpm vitest run` against M04's `compileFormSnapshot` golden-fixture suite, exercised end-to-end by saving a portal form here and asserting a `form_versions` row appears with a snapshot that zod-parses as `FormSnapshot`.
- Duplicate/delete works — manual + the RESTRICT-delete assertion above.
- `maps_to` targets restricted to the closed allowlist — `pnpm vitest run` asserts the field-CRUD save rejects any `maps_to` value not in the 8-triple table (or not in the CFP allowlist, if a custom field accidentally sets one) — this validation actually lives in M12/M04's shared save path, this module just must not bypass it.

## Guardrails

- **This module adds no new server logic.** Every mutation is M12's. If a step here seems to need a new endpoint, that is a signal to re-check whether M12 already exposes it generically — resist building a parallel portal-only form-save path; the whole point of the shared engine (data-model.md §3.4/§5.1) is one producer.
- **Cut-line #10 is real and dated — and Step 1 makes firing it free.** The 2 seeded portal forms **are** cut-line #10's reduced form. Building them first means that if the Mon-noon micro-checkpoint (M25 rendering WS-B's real snapshot end-to-end) misses, the cut is a **no-op**: this module's UI is dropped *that day*, not deferred to Tuesday, and the runtime keeps working against forms that already exist. Do not keep polishing this UI past that checkpoint if it's missed; move to M25/M41 work instead.
- **field_type naming (step 5):** re-read the naming-gotcha note before writing the field-type dropdown options — a stray `'wysiwyg'` string anywhere here will fail the DB enum insert.
- **maps_to is a closed allowlist enforced server-side** (data-model.md §3.4) — this builder must never let an admin type an arbitrary `maps_to` string; it is always chosen from the standard-field library's fixed dropdown or left `null` for custom fields.
- **No visibility/routing UI here, ever** — a portal form that accidentally inherits CFP wizard chrome (deadline banners, participant-role pickers, routing rules panel) is a review-blocker; this is a single-page, linear-forms-only surface.

## If blocked

If M12's field-CRUD components aren't extractable standalone yet (i.e. tightly coupled to the CFP wizard shell): start on M23 first (independent of M12) and return to this module once M12 lands Sunday night / Monday AM. If M12 is ready but this agent is still finishing M23, this module is next in the Monday queue per WS-D's order — do not skip ahead of M23 unless M23 is fully blocked.
