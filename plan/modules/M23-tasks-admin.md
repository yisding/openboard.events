# M23 — Tasks + file requests (admin)

| | |
|---|---|
| **Status** | IN PROGRESS — **IMPLEMENTED on branch (rev. 10 run)**, no active claim. `src/features/portal/tasks-admin/server/{queries,mutations}.ts` now provide `listTasks`/`getTaskTabCounts`/`getTaskCompletionMatrix`/`listFileRequests`/`saveTask`/`deleteTask`/`reopenCompletion`/`saveFileRequest`/`deleteFileRequest` over real `portal_tasks`/`file_requests` rows, with every count read from `task_assignments_v`, mode-lock CHECK-mirroring in zod, and `endOfDayInTz` due-date conversion, behind new API routes and a real admin UI (`TasksAdminView`/`TaskEditor`/`TaskMatrixDrawer`/`FileRequestsView`) at `src/app/events/[eventId]/tasks/page.tsx`. 11 new PGlite tests cover fan-out, reopen, mode-lock, and the RESTRICT delete guard. Remaining before `DONE`: deployed/browser AC. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-D agent (`features/portal` — "admin tasks" sub-area; distinct from WS-C's Monday-declared `features/portal/{resources,admin}/**` grant for M26/M27 — this module owns `features/portal/tasks-admin/**`, not `features/portal/admin/**`). |
| **Scheduled** | Monday, alongside M24 and M25's form-mode, per WS-D's order (`M23 + M24 + M25 form-mode (Mon)`). |
| **Size** | M |
| **Paths owned** | `src/features/portal/tasks-admin/server/queries.ts`, `src/features/portal/tasks-admin/server/mutations.ts`; `src/features/portal/tasks-admin/components/**`; `src/app/(admin)/events/[eventId]/tasks/page.tsx`; `src/app/api/internal/tasks/route.ts`, `src/app/api/internal/tasks/[id]/route.ts`, `src/app/api/internal/tasks/[id]/reopen/route.ts`, `src/app/api/internal/file-requests/route.ts`, `src/app/api/internal/file-requests/[id]/route.ts`; (append-only: one export block in `src/features/portal/index.ts`) |

## Objective

The organizer-facing admin surface for `portal_tasks` and `file_requests`: create/edit tasks (manual/form/file_request completion modes), tabs by target type with live counts, a completion matrix (task × assignee), and file-request CRUD. When done, an organizer creates a submission-targeted task and instantly sees one assignment row per accepted submission's primary contact — with zero backfill code, because assignments are a lazy SQL view, not rows this module inserts.

## Dependencies

- **Hard (blocks start):** [./M03-db-schema-migrations.md](./M03-db-schema-migrations.md) (`portal_tasks`, `file_requests`, `task_completions` tables + the `task_assignments_v` view migrated). [./M05a-admin-shell-ui.md](./M05a-admin-shell-ui.md) (`DataTable`, tabs, `EmptyState`). [./M05b-rich-ui-primitives.md](./M05b-rich-ui-primitives.md) (`<RichTextEditor>` for task descriptions/instructions).
- **Soft:** [./M25-task-runtime.md](./M25-task-runtime.md)'s org-side response/upload viewer components (`<TaskResponseViewer>`/`<TaskUploadViewer>`) — if M25 hasn't reached that step yet on the same Monday, stub the completion-matrix row detail as a plain "N responses / N uploads" count with no drill-in, and swap to the real viewer components the moment M25 exports them (same agent, same day).

## Provides (interfaces others consume)

```ts
// appended to src/features/portal/index.ts
export async function listTasks(eventId: EventId, filters?: TaskFilters): Promise<TaskDTO[]>;
export async function saveTask(eventId: EventId, input: SaveTaskInput): Promise<TaskDTO>;
export async function saveFileRequest(eventId: EventId, input: SaveFileRequestInput): Promise<FileRequestDTO>;
export async function getTaskCompletionMatrix(eventId: EventId, taskId: string): Promise<TaskAssignmentDTO[]>;
// TaskAssignmentDTO is M02's contracts type (contracts/task.ts) — the 1:1 mirror of task_assignments_v.
// NOT `TaskAssignmentRow`: that is M03's `src/db/views.ts` view-row type, and a feature barrel must never
// re-export a db type. M25's richer join type is a DIFFERENT name (`MyTaskDTO`), so the two never collide.
export async function reopenCompletion(eventId: EventId, taskId: string, contactId: string, submissionId: string | null): Promise<void>;
```

- `listTasks` consumed by: [./M25-task-runtime.md](./M25-task-runtime.md) (speaker task list reads the same task metadata joined against `task_assignments_v` for its own contact).
- `getTaskCompletionMatrix` reuses [./M25-task-runtime.md](./M25-task-runtime.md)'s viewer components (soft dependency above).
- Task/file-request rows are referenced by [./M24-portal-form-builder.md](./M24-portal-form-builder.md) (a task with `completion_mode='form'` points at a `forms` row M24's builder edits) and [./M07-r2-storage.md](./M07-r2-storage.md) (file-request uploads use `kind='upload'` with `policyOverride` from `file_requests.accepted_extensions`/`max_size_mb`).

## Step-by-step implementation

1. **Contract-first slice.** Append the five signatures above to `src/features/portal/index.ts` as typed stubs. **Done when:** `pnpm typecheck` passes; M25 (same agent, same day) can import `listTasks` immediately.

2. **The fan-out rule is consumed, never re-derived (resolution #14).** This module does **not** write assignment rows. `task_assignments_v` (migrated in M03) already encodes: contact-targeted tasks → one row per member of `accepted_speakers_v`; submission-targeted tasks → one row per accepted submission's **primary** contact only (`submission_participants.is_primary`). Every count and every completion-matrix row this module renders comes from querying this view, filtered `WHERE task_id = $taskId`. **Do not** write a "materialize assignments" mutation anywhere in this module — if you find yourself about to `INSERT INTO task_completions` for a non-completed state, stop; that table holds completions only. **Done when:** a PGlite test creates a submission-targeted task against a seeded co-speakered accepted submission and asserts `task_assignments_v` returns exactly one row (the primary contact), confirming the view — not this module's code — enforces the rule.

3. **`listTasks(eventId, filters)`.**
   - Reads `portal_tasks` joined with a per-task aggregate over `task_assignments_v`: `count(*) FILTER (WHERE completed)`, `count(*) FILTER (WHERE NOT completed)`, `count(*) FILTER (WHERE overdue)`.
   - `filters.targetType` narrows `All | Contact | Submission` (Group is out of scope — brief is speakers-only, per speaker-portal analysis simplification #1).
   - **Done when:** tab counts (`All Tasks (n)`, `Contact Tasks (n)`, `Submission Tasks (n)`) match a hand-count of seeded tasks.

4. **`saveTask(eventId, input)`.**
   - Zod input: `{id?, name, descriptionHtml, targetType: 'contact'|'submission', completionMode: 'manual'|'form'|'file_request', formId?, fileRequestId?, dueAt?: ISO date, isActive}`.
   - Server-side CHECK-mirroring validation before the DB CHECK constraint even fires (friendlier error): `completionMode='form' ⟺ formId present`, `completionMode='file_request' ⟺ fileRequestId present`.
   - `dueAt`, if provided as a date-only input, converts via `endOfDayInTz(dateISO, event.timezone)` (resolution #9's `time.ts`) — **never** store a naive local midnight.
   - `sanitize(descriptionHtml)` before persisting. Single-statement upsert — no `withTx`, this is not one of the 8 audited transactional functions.
   - **Mode-lock:** if `task_completions` has ≥1 row for this task, reject changes to `targetType` or `completionMode` (and to `formId`/`fileRequestId`) with **`AppError('FORM_LOCKED')`** and the message "This task has completions. Create a new task to change its type." — `APP_ERROR_CODES` ([M02](./M02-shared-contracts.md) §6) is a **closed** enum and there is no `TASK_LOCKED` in it; `FORM_LOCKED` already carries exactly this "structure frozen by existing responses" meaning and is mapped to 400 by [M04](./M04-shared-libs.md). Do not invent a code. Switching a task's shape after speakers have completed it must not orphan/reset their completions silently (analysis edge case #4).
   - **Done when:** PGlite test — saving a task with an active completion present and a changed `completionMode` is rejected; changing only `name`/`descriptionHtml`/`dueAt`/`isActive` on the same task succeeds.

5. **`saveFileRequest(eventId, input)`.**
   - `{id?, title, targetType, instructionsHtml, acceptedExtensions: string[], maxSizeMb}`, defaults `acceptedExtensions = ['pdf','ppt','pptx','key','zip','png','jpg','jpeg']`, `maxSizeMb = 100` (DDL defaults).
   - `sanitize(instructionsHtml)`.
   - **Done when:** creating a file request with a custom extension list is immediately usable by M07's `policyOverride` on the next presign call referencing it.

6. **Delete guard (RESTRICT).**
   - Deleting a `forms` row or `file_requests` row referenced by any `portal_tasks.form_id`/`file_request_id` is blocked at the DB level (`ON DELETE RESTRICT`, per data-model.md §3.8).
   - This module's delete-form/delete-file-request UI (if it lives here vs. M24 for forms) must catch the resulting FK-violation and show: **"This form/file request is used by a task. Revert the task to Manual first."** — never a raw 500.
   - **Done when:** attempting to delete an in-use file request via the API returns a typed friendly error, not a stack trace.

7. **Admin Tasks page UI** (`app/(admin)/events/[eventId]/tasks/page.tsx`).
   - Header "Tasks" / subtitle "Create tasks that can be assigned to your portals".
   - **+ Add** split button: Add Task / Copy from… — Copy from… is out of scope, single-event demo per simplifications.
   - Search input.
   - Tabs: **All Tasks (n) / Contact Tasks (n) / Group Tasks (0, permanently) / Submission Tasks (n)** — Group is never built, keep the tab for taxonomy parity but it never has content.
   - Task row cards with a completion-mode chip (`Manual`/`Form`/`File Request`), target-type icon, kebab menu (Edit/Delete). Use `<DataTable>` or a simple card list — match the reference screenshots' card layout, not a dense table.
   - **Done when:** the seeded 3 tasks (one overdue) render with correct chips and counts.

8. **Task detail / completion matrix drawer or page.**
   - For a selected task: a table of `task_assignments_v` rows scoped to it — contact name, submission code (if applicable), completed/open/overdue status, "completed via" badge.
   - Admin **Reopen** action → `reopenCompletion` → `DELETE FROM task_completions WHERE task_id=$1 AND contact_id=$2 AND submission_id IS NOT DISTINCT FROM $3`. Reminders do **not** resume with a fresh ladder after reopen — their idempotency keys stay consumed, documented behavior per data-model.md §4.3, not a bug.
   - **Done when:** reopening a completed row flips it back to open in the matrix and the dashboard's outstanding count increments on next poll.

9. **File Requests drawer/tab** (mirrors screenshot 9).
   - Title, type (Contact/Submission cards), rich-text instructions, extensions, max size — `saveFileRequest` wired.
   - **Done when:** a created file request is immediately selectable as the `fileRequestId` for a new `completion_mode='file_request'` task.

## Acceptance criteria

Copied verbatim from the catalog (PLAN.md §4, M23), plus verification commands:

- Creating a submission-task instantly materializes assignments for every accepted submission's primary contact (lazy view — includes late-accepted, zero backfill code; co-speakered submission = exactly one assignment) — `pnpm vitest run src/features/portal/tasks-admin/**/*.test.ts -t fan-out` (step 2's test) plus a second assertion: seed a new `accepted` submission *after* the task exists and confirm it appears in the matrix with no code run.
- Admin can reopen a completion — `pnpm vitest run src/features/portal/tasks-admin/**/*.test.ts -t reopen`.

## Guardrails

- **Resolution #14 is the load-bearing rule of this module.** If any step here computes assignment counts by summing something other than a `task_assignments_v` query, it is wrong — the dashboard (M38) and the portal (M21/M25) must produce identical counts because they all read the same view.
- **`task_completions` unique constraint** is `UNIQUE NULLS NOT DISTINCT (task_id, contact_id, submission_id)` — completion inserts elsewhere in the system (M25) are idempotent by construction; this module never inserts completions itself, only deletes them (reopen).
- **Mode-lock (analysis trap #4):** re-verify this on every `saveTask` call, not just in the UI — a curl-based PATCH bypassing a disabled button must still be rejected server-side.
- **Timezone (analysis trap #9 / resolution #9):** `due_at` is `timestamptz`; a date-only picker input must go through `endOfDayInTz(dateISO, event.timezone)`, never a naive `new Date(dateString)` which parses as UTC or local-server-tz depending on runtime — this is the exact off-by-one-day bug the analyses flag.
- **Empty states (analysis trap #10):** four distinct empty states exist in the reference product (no submission tasks / no tasks / no forms yet / no file requests yet) — zero-count tabs render "0", never hide.
- **Sanitize on save** (`descriptionHtml`, `instructionsHtml`) — both are rendered later in the speaker-facing portal (M25) and must never carry unsanitized organizer HTML.
- **RESTRICT delete (analysis trap #20):** never attempt a cascading delete or silent detach — the DB constraint is the backstop, but the UI copy above ("revert to manual first") must ship, not a raw constraint-violation error.

## If blocked

If M25 hasn't yet exported its viewer components when this module reaches step 8: ship the matrix with plain counts (no response/upload drill-in) and file a one-line note in this doc's PR description; swap the real components in later the same day. If genuinely blocked (M03's view not migrated), move to M24 (portal form builder) — it only needs M12, which lands Sunday night, well before Monday.
