# M25 — Speaker task runtime + completions

| | |
|---|---|
| **Status** | IN PROGRESS — **claimed by Claude** for the server runtime (steps 2, 5, 7, 9, 10): `listMyTasks` over `task_assignments_v`, the three completion paths with their two audited `withTx` bodies, field-scoped write-back, and the three portal routes, with PGlite coverage of fan-out independence, idempotency and write-back scoping. The speaker pages and the org-side viewers (steps 3–4, 6, 8, 11) follow in their own PR. The merged localStorage **STACK-DEMO** runtime stays in place until then. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-D agent (`features/portal` — "tasks runtime" sub-area). |
| **Scheduled** | Sunday (manual + file modes, alongside M22) → Monday (form mode, alongside M23/M24), per WS-D's order. **Mon-noon micro-checkpoint (hard integration point, PLAN.md §6):** a portal form task must render WS-B's real `FormSnapshot` end-to-end through the real `<FormFieldRenderer>` import. A miss triggers **cut-line #10** the same day (seeded portal forms only, builder UI cut — see M24), not deferred to Tuesday. |
| **Size** | L |
| **Paths owned** | `src/features/portal/task-runtime/server/queries.ts`, `src/features/portal/task-runtime/server/mutations.ts`; `src/features/portal/task-runtime/components/**` (incl. `<TaskResponseViewer>`, `<TaskUploadViewer>` — org-side viewers exported for M23); `src/app/(portal)/portal/[eventSlug]/tasks/page.tsx`, `src/app/(portal)/portal/[eventSlug]/tasks/[taskId]/page.tsx`; `src/app/api/internal/portal/tasks/route.ts`, `src/app/api/internal/portal/tasks/[taskId]/complete/route.ts`, `src/app/api/internal/portal/tasks/[taskId]/upload/route.ts`; (append-only: one export block in `src/features/portal/index.ts`) |

## Objective

The speaker-facing task list and all three completion paths (manual button, form fill, file upload). When done:
- a speaker with 2 accepted sessions sees a submission-scoped task once per session and completes each independently,
- a form task renders the pinned portal-form snapshot, prefills from mapped record fields, and writes answers back to the contact/submission record on submit,
- a file task uploads through M07 and auto-completes.

This is the module the dashboard's "outstanding tasks" story (brief feature #6) is ultimately demoed against.

## Dependencies

**Hard (blocks start):**
- [./M21-portal-shell.md](./M21-portal-shell.md) — portal shell/`requirePortalContext`, the `@/features/portal` barrel's `updateContactFields`, Home's Tasks widget pattern to extend into a full page.
- [./M07-r2-storage.md](./M07-r2-storage.md) — `createUpload`/`finalizeUpload` for file-mode.
- [./M03-db-schema-migrations.md](./M03-db-schema-migrations.md) — `task_completions`, `form_responses`, `file_uploads` tables + the `task_assignments_v` view.

**Soft (start against stub/fixture):**
- [./M23-tasks-admin.md](./M23-tasks-admin.md) — **soft, not hard.** Task metadata comes from `scripts/seed/portal.ts`'s **3 seeded tasks + 1 file request** (WS-D-owned, landed Sat PM). M23's admin UI is **not required** to build or test this runtime; only M03's tables must exist. This module runs **Sunday**, M23 runs **Monday** — treating it as a blocking dependency would stall WS-D's Sunday behind its own Monday queue.
- [./M24-portal-form-builder.md](./M24-portal-form-builder.md) — **soft.** The form-mode slice renders the **2 seeded portal forms** (also from `scripts/seed/portal.ts`, authored by M24 Step 1 which ships them *before* any builder UI). M24's builder UI is never on this module's critical path — that is exactly why cut-line #10 is free.
- [./M16-submit-pipeline.md](./M16-submit-pipeline.md) — `runSubmitPipeline` for step 9's server-side re-validation. Portal snapshots carry no visibility rules, so the visibility pass is a no-op; the call still costs nothing and keeps one code path (R12).

**And the load-bearing one:**
- [./M15-public-cfp-wizard.md](./M15-public-cfp-wizard.md)'s `<FormFieldRenderer>`, consumed **strictly** through the Phase-0 `FormFieldRendererProps` contract (`{snapshot, answers, onChange, mode}`, zero CFP-wizard imports).
- Build the form-mode slice **Sunday against the golden `FormSnapshot` fixture** ([./M02-shared-contracts.md](./M02-shared-contracts.md)'s Phase-0 artifact) with a local stub renderer implementing the exact same props shape.
- Swap the import to `@/features/forms`'s real `<FormFieldRenderer>` the moment M15 lands (Sun night–Mon).
- The **Mon-noon micro-checkpoint** is this swap working end-to-end against a real seeded portal form — not the fixture.

## Provides (interfaces others consume)

```ts
// appended to src/features/portal/index.ts
// NAME: MyTaskDTO — deliberately NOT `TaskAssignmentDTO`. That name is M02's contracts type
// (contracts/task.ts), the 1:1 mirror of task_assignments_v with {contactId, completedVia}; two exported
// types of the same name in @/shared/contracts and @/features/portal would collide at every import site.
// This one is the enriched join used by the speaker-facing list.
export interface MyTaskDTO {
  taskId: string;
  taskName: string;
  descriptionHtml: string | null;
  completionMode: 'manual' | 'form' | 'file_request';
  targetType: 'contact' | 'submission';
  submissionId: string | null;      // null for contact-targeted rows
  submissionCode: string | null;
  submissionTitle: string | null;
  dueAt: string | null;             // ISO UTC; render via TzTime, never Date() math here
  completed: boolean;
  completedAt: string | null;
  overdue: boolean;                 // straight passthrough of task_assignments_v's own boolean
}

export async function listMyTasks(eventId: EventId, contactId: string): Promise<MyTaskDTO[]>;
export async function completeTaskManual(
  eventId: EventId, contactId: string, taskId: string, submissionId: string | null,
): Promise<void>;
export async function completeTaskViaResponse(
  eventId: EventId, contactId: string, taskId: string, submissionId: string | null,
  answers: Record<string, AnswerValue>,
): Promise<void>;
export async function completeTaskViaUpload(
  eventId: EventId, contactId: string, taskId: string, submissionId: string | null,
  fileAssetId: string,
): Promise<void>;
```

Reference note, not this module's job to act on: `portal_tasks.created_at` and each target's materialization instant (the submission's `decided_at` for submission-targeted rows) feed [./M36-reminder-scan.md](./M36-reminder-scan.md)'s reminder-suppression rule — a task created due-tomorrow must never fire a −7d reminder rung. This module implements none of that; it's called out so nothing here accidentally duplicates it — do not add a "send reminder" side effect anywhere in this module, M36's cron scan owns all reminder sends.

Consumers:
- `<TaskResponseViewer>` / `<TaskUploadViewer>` (client components, exported via `index.client.ts`) — consumed by [./M23-tasks-admin.md](./M23-tasks-admin.md)'s completion-matrix drawer (soft dependency, documented in M23's doc).
- `listMyTasks` — consumed by [./M21-portal-shell.md](./M21-portal-shell.md)'s Home Tasks widget once this module lands. M21 built its own inline `task_assignments_v` read first; this module's richer DTO is the eventual single source. No forced swap is required — both read the same view.
- Task completion rows feed `speaker_outstanding_v` / `task_assignments_v` — consumed by [./M38-dashboard.md](./M38-dashboard.md) (dashboard outstanding-task counts) and [./M39-airtable-export.md](./M39-airtable-export.md) (Airtable Task Status table) with zero code coupling, pure DB read-model.

## Step-by-step implementation

1. **Contract-first slice.**
   - Append the four signatures above to `src/features/portal/index.ts` as typed stubs.
   - Write the local `FormFieldRendererProps`-shaped stub renderer now: a plain form rendering each visible field from a `FormSnapshot` fixture (text/richtext/dropdown/multiselect/email/url/file inputs; no conditional logic needed for portal forms) so form-mode work can start Sunday without M15.
   - **Done when:** `pnpm typecheck` passes; the stub renderer round-trips the golden `FormSnapshot` fixture (renders every field, calls `onChange` correctly) in a scratch page.

2. **`listMyTasks(eventId, contactId)`.**
   - Reads `task_assignments_v WHERE contact_id = $contactId` joined to `portal_tasks` (name, description_html, completion_mode, due_at) and, for submission-targeted rows, the submission's code/title.
   - Groups into **My Tasks** (contact-targeted) and **Submission Tasks** (grouped by submission code, collapsible) — grouping may happen in the DTO or client-side, either is fine as long as it's derived from one fetch.
   - Overdue = the view's own `overdue` boolean (`open AND due_at < now()`, computed in SQL) — never recomputed in JS against the client clock.
   - **Done when:** a co-speakered accepted submission's primary contact sees exactly one row per submission-targeted task per submission — the fan-out is already correct because the view enforces it; this module only reads.

3. **Speaker task list page** (`app/(portal)/portal/[eventSlug]/tasks/page.tsx`), mirrors M21's Home Tasks card but full-featured:
   - shadcn `Tabs`: All / My Tasks (n) / Submissions (n) — counts computed client-side from the same fetched `MyTaskDTO[]`, never a second query (analysis trap #18).
   - A `DropdownMenu` "Filter" control: Open / Completed / Overdue — pure client-side filter over the already-fetched list, no extra round-trip.
   - Two `Accordion` sections, "My Tasks" and "Submission Tasks" (the latter grouped by `submissionCode`, one sub-accordion per submission), with "Open All"/"Collapse All" buttons driving the `Accordion`'s controlled `value` array.
   - Each row is a `Card`: title, `<TzTime>` due date, a red `Badge` "Overdue" when `overdue=true`, a Completed/Open status pill.
   - Clicking a row → `/tasks/[taskId]` (submission-scoped tasks pass `?submissionId=`, since the same `taskId` can have multiple independent assignment rows — the detail page reads both params to know which specific assignment it's completing).
   - **Done when:** a speaker with 2 accepted sessions and one submission-targeted task sees two independent rows, each completable without affecting the other (verified in step 8's test); the Filter dropdown narrows the list with zero new network requests (confirm in DevTools).

4. **Task detail page — manual mode** (`.../tasks/[taskId]/page.tsx`, `completion_mode='manual'` branch).
   - Renders `description_html` via `<RichTextView>`, a single "Mark as complete" button.
   - **Done when:** clicking it flips the row to Completed and it disappears from the "open" filter on next fetch.

5. **`completeTaskManual(eventId, contactId, taskId, submissionId)`.**
   - Single-statement guarded insert: `INSERT INTO task_completions (event_id, task_id, contact_id, submission_id, completed_via) VALUES (..., 'manual') ON CONFLICT DO NOTHING`.
   - Not one of the 8 audited `withTx` functions (nothing else to write atomically with it) — the `db` default (neon-http) is correct here.
   - **Done when:** PGlite test — calling this twice (simulating a double-click) results in exactly one `task_completions` row, no error thrown on the second call.

6. **Task detail page — file mode** (`completion_mode='file_request'` branch).
   - Renders `file_requests.instructions_html`, accepted extensions/max size as helper text.
   - `<FileUpload kind="upload" policyOverride={{extensions: acceptedExtensions, maxSizeMb}}>` wired to M07's `createUpload`/`finalizeUpload`.
   - Lists this contact's existing uploads for this request, most recent first — **keep all uploads, show latest** (analysis simplification #12); no delete, "replace" = upload a new one.
   - **Done when:** uploading a file end-to-end on the deployed preview (390px viewport) succeeds and the task flips to Completed.

7. **`completeTaskViaUpload(eventId, contactId, taskId, submissionId, fileAssetId)`** — in `withTx` (one of the 8 audited transactional functions, data-model.md §1.1):
   - Insert `file_uploads (file_request_id, contact_id, submission_id, file_asset_id)`.
   - Insert `task_completions (..., completed_via='file_upload', file_upload_id=...)` `ON CONFLICT DO NOTHING`.
   - Same transaction; the completion insert happens **after** the upload row commits within the tx — a task must never show Completed with no file behind it (analysis edge case #14).
   - **Done when:** PGlite test — a second upload against an already-completed task adds a new `file_uploads` row but does not error and does not duplicate the completion row.

8. **Task detail page — form mode** (`completion_mode='form'` branch; **Sunday: build against the fixture; Monday: swap to real M15 import**):
   - Fetch the attached form's **latest** compiled snapshot (`forms.current_version` → `form_versions.snapshot`). Portal task forms are low-churn admin-authored forms, not the public CFP surface, so this module deliberately does **not** implement `FORM_VERSION_STALE` handling — it re-validates against whatever version was current at render time. Documented scope simplification, not an oversight.
   - Prefill initial `answers` from mapped record fields: for each field with a `maps_to`, resolve the current value from `contacts`/`submissions` (e.g. `contact.bio_html` → the contact's current bio), so "Update Your Information" genuinely shows current data.
   - Render via **`<FormFieldRenderer snapshot={...} answers={...} onChange={...} mode="edit">`** — imported from the fixture stub Sunday, from `@/features/forms` Monday. **This import line is the only thing that changes at the swap**, per the hard module-boundary contract.
   - **`mode="edit"`, not `"fill"`.** The frozen union in [M02](./M02-shared-contracts.md) §5 is `'edit' | 'review' | 'readonly'`; `'fill'` exists in no contract, and a literal `mode="fill"` would fail to typecheck on the *exact prop* the Mon-noon micro-checkpoint exists to validate — the highest-stakes contract in the build. Task-form filling is the same interaction as CFP editing, so `'edit'` is correct on the merits too. The **local stub renderer from step 1 must declare the same three-value union**, or the swap silently changes the type.
   - **Done when (Sunday):** the fixture-backed form renders and submits against the golden snapshot.
   - **Done when (Monday, the micro-checkpoint):** a real seeded portal form (M09/M24) renders end-to-end through the real `<FormFieldRenderer>` and a submit round-trips.

9. **`completeTaskViaResponse(eventId, contactId, taskId, submissionId, answers)`** — in `withTx` (one of the 8 audited transactional functions):
   - (a) **Re-fetch the form's snapshot server-side and re-run validation against it** — never trust that the client-rendered snapshot is still current. The organizer may have edited the portal form between page load and submit; an unknown/removed field id in the posted payload must be dropped-and-logged, not 500'd (analysis edge case #7). Call **`runSubmitPipeline(snapshot, answers, {participantId: null, requireRequired: true})`** from `@/features/forms` ([M16](./M16-submit-pipeline.md)'s exported **pure** pipeline): it performs parse → visibility → strip → validate in one call and returns `CleanAnswers`. **There is no `validateRequired` in `@/shared/lib/conditions`** — that file exports exactly `evaluateCondition`, `evaluateRule`, `evaluateVisibility`, `stripHiddenAnswers`, `applyRouting`, `isAnswered`, `cleanAnswersToRecord`; required-field validation lives inside the pipeline, and M16 explicitly keeps the signature portal-friendly. Portal snapshots carry no visibility rules, so the visibility pass is a no-op, but calling the same shared pipeline costs nothing and keeps one code path (R12).
   - (b) Upsert `form_responses` (`ON CONFLICT (form_id, contact_id, submission_id) DO UPDATE SET answers=..., form_version=..., updated_at=now()` — resubmit overwrites, no versioned history, per simplification #6).
   - (c) **Field-scoped write-back**, split by target: for every answered field with `maps_to` starting `contact.` → build one partial patch object and call **`updateContactFields(tx, eventId, contactId, patch)` from the `@/features/portal` barrel** — the helper lives in `src/features/portal/server/contacts.ts`, owned by [./M21-portal-shell.md](./M21-portal-shell.md) Step 0 (not M06b, which is only another caller) (resolution #13 — never a whole-row update; this is the correct place to route through that helper even inside this module's own `withTx`, since the underlying UPDATE still must be field-scoped). For every answered field with `maps_to` starting `submission.` → this module's own guarded, field-scoped `UPDATE submissions SET <only the present columns> WHERE id=$1 AND event_id=$2` — this is **not** a new `INSERT INTO submissions` and not a status transition, so it does not violate resolution #8's single-INSERT-owner rule; it is the same class of narrow typed-column update M17's admin edit already performs independently.
   - (d) Insert `task_completions (..., completed_via='form_response', form_response_id=...)` `ON CONFLICT DO NOTHING`, **after** (b) and (c) commit within the same transaction.
   - **Done when:** PGlite test — submitting a "Bio" field write-back updates only `contacts.bio_html`, leaving `company`/`job_title` untouched even if another row is mid-edit; a "Session Title" field write-back updates only `submissions.title`; double-submit (retry) does not duplicate the completion row and the response upsert is idempotent.

10. **Routes** — `GET /api/internal/portal/tasks`, `POST .../[taskId]/complete`, `POST .../[taskId]/upload`.
    - `defineHandler({ auth: portalAuth(), … })` — the guard **factory call** from `@/features/auth`, never the string `'portal'` ([M04](./M04-shared-libs.md) §8) — thin wrappers over steps 2/5/7/9 — the complete route dispatches on the task's `completion_mode` to call the right `completeTask*`.
    - **Done when:** each route is curl-testable with a valid portal session cookie against seeded data.

11. **Org-side viewers** (`<TaskResponseViewer taskId>`, `<TaskUploadViewer taskId>`, client components exported via `index.client.ts`).
    - Read-only tables of `form_responses`/`file_uploads` joined to `task_completions` for a given task: recipient name, submitted/uploaded date, answers (label from the snapshot + value) or file name/size + a `getDownloadUrl` link (M07).
    - **Done when:** M23 mounts these inside its completion-matrix drawer and they render seeded data.

## Acceptance criteria

Copied verbatim from the catalog (PLAN.md §4, M25), plus verification commands:

- Speaker with 2 accepted sessions sees the submission task once per accepted submission and completes them independently — `pnpm vitest run src/features/portal/task-runtime/**/*.test.ts -t fan-out-independent-completion`.
- Double-click completes once (PGlite upsert test) — `pnpm vitest run src/features/portal/task-runtime/**/*.test.ts -t idempotent-complete` (steps 5, 7, 9).
- Completing drops the dashboard outstanding count on next poll — manual check against M38 once both are live; the unit-level guarantee is that a `task_completions` insert is the only thing `speaker_outstanding_v` depends on.
- Write-back updates the contact bio visible in admin — `pnpm vitest run src/features/portal/task-runtime/**/*.test.ts -t write-back-field-scoped` (step 9).
- Full phone-width (390px viewport) run-through: portal login → complete a file task — Playwright or manual DevTools device emulation on the deployed preview.

## Guardrails

- **`FormFieldRendererProps` is a hard boundary — zero CFP-wizard imports, ever.** This module must never import anything from `@/features/forms/components/wizard/**` or similar; only the barrel's `<FormFieldRenderer>` export. Grep your own diff before marking step 8/9 done.
- **The Mon-noon micro-checkpoint is a scheduling gate, not optional polish** (PLAN.md §6, cut-line #10). If the real snapshot doesn't render by Monday noon, stop building more form-mode UI and report it the same day. The fallback (2 seeded portal forms, builder UI cut) is M24's concern, not this module's — this module's runtime code does not change either way, only which forms exist to render.
- **Two of the eight audited `withTx` functions live in this module**: `completeTaskViaResponse` and `completeTaskViaUpload`; manual mode's single-statement insert deliberately does *not* use `withTx`. Do not open a transaction anywhere else in this module — resolution #4 confines WebSocket `Pool` usage to exactly the eight named functions repo-wide.
- **Field-scoped write-back, both directions** (resolution #13 + analysis trap #5): contact fields go through `updateContactFields`; submission fields are a narrow, explicitly-column-listed `UPDATE`, never `set(record)`/whole-row. A stale form submit must never clobber a fresher Profile-page edit (M22) or a fresher admin Abstracts edit (M17) — field-scoping is what makes last-write-wins acceptable here.
- **Auto-complete ordering** (analysis trap #14): the completion row is inserted only after the response/upload row's insert succeeds, in the same transaction — never mark complete first "optimistically."
- **Answers stored by field_id, not label** (analysis trap #8) — this module never keys anything by a field's label string; deleted/soft-deleted fields' historical answers stay readable in the org-side viewer.
- **Timezone** (analysis trap #9): overdue is read from the view's precomputed boolean, never recomputed client-side against `new Date()`.
- **R10 nullable-render:** a task with no due date, a submission task on a submission with no track, an upload list with zero uploads — all designed states, not crashes.
- **Required-field validation drift** (analysis trap #7): always re-validate against the server's current copy of the snapshot at submit time, never assume the client's rendered snapshot is still valid — a stale/unknown field id in the payload is dropped-and-logged, not a 500.
- **`noUncheckedIndexedAccess` (R6):** answers/prefill maps are keyed by field id; every lookup (`answers[field.id]`) must be treated as possibly `undefined` — this module is a prime spot for a silent `undefined` write-back if that's ignored.

## If blocked

If M15's real `<FormFieldRenderer>` is late past Monday noon: this triggers cut-line #10 — stop polishing form-mode UI, verify manual + file modes are fully solid (steps 3–7, already landed Sunday), and move to M41 prep (read M16's pipeline signature, M18's `updateSubmissionFromCfp` signature) so Tuesday's module starts instantly. **M23 and M24 are soft dependencies** (see Dependencies): the seeded 3 tasks + 1 file request + 2 portal forms from `scripts/seed/portal.ts` are the intended fixture, so never wait on M23's admin UI or M24's builder — only on M03's tables existing. If even the seed is missing, insert a throwaway task/file-request row via a scratch script and keep going.
