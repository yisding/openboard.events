# M52 — Content and deliverables lifecycle

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED (rev. 11 / PR #94), finish pass landed at rev. 12 / PR #95**, no active claim. Implemented via additive migration `drizzle/0006_content_deliverables.sql` (`file_uploads.version`/`is_latest`, `file_comments`, `session_content_revisions`, `file_export_jobs`): file versions + a shared `deliverable-slot.ts` comment thread module used by both the speaker task detail and the organizer's central Files view (`src/app/events/[eventId]/files`, filterable, bulk-remind via `sendRemindersNow`); session content history/restore inside the existing single-statement `saveSessionIn`; organizer speaker bio/headshot edit through the existing `updateContactFields`; and a dependency-free STORE-method ZIP export job pipeline (`createFileExportJobIn`/`processFileExportJobIn`, always resolves completed/failed, fired via `ctx.waitUntil`). The rev. 12 finish pass closed the one concrete code-queue item: the central Files view filtered client-side despite the GET route already supporting server-side filters — now fixed (`deliverableFiltersSchema` shared between route and page, a new `getDeliverableStateCountsIn` aggregate driving the tab badges instead of a full fetch, `FilesAdminView` pushing filter changes into the URL). `e2e/speaker-content-ops.spec.ts`'s M52 describe block and its `landed.ts` gate arrived (uncommitted, in the shared tree) and needed no further changes — reviewed in full and confirmed compatible with the filtering rewrite. Remaining before `DONE` is deployed evidence only: no browser/real-R2-binding verification of any surface (the ZIP's actual object-read/build/write round trip has no fake R2 binding in any harness available so far), and the Workers Free CPU budget for a synchronous ZIP build is still an open, unmeasured architectural risk. See [`../status.md`](../status.md) §2g. |
| **Workstream / executing agent** | WS-D leads files/deliverables; WS-E owns session revisions/publication; WS-F owns reminders/export jobs. |
| **Scheduled** | Post-R3 product-completeness wave, parallel with M50/M51/M53. |
| **Size** | XL; split M52a files/deliverables and M52b session revisions/export. |
| **Paths owned** | Existing portal file/task areas, agenda session-content area, comms/jobs extensions, central Files routes, additive migrations, and `e2e/speaker-content-ops.spec.ts`. |

## Objective

Give organizers and speakers a complete lifecycle for files and session content: version history,
cross-role comments, central discovery, filtered follow-up, attributed content revisions and restore,
publication approval, and bulk export of the latest approved deliverables.

## Dependencies

- **Hard:** M07 R2/auth, M22 profile writes, M23 task admin, M25 task runtime, M28 sessions, M34
  outbox, and M36 reminder selection/idempotency.
- **Ownership:** R2 storage, task fan-out, comms, session publication, and contact writes stay with
  their current owners; this module composes them through barrels/contracts.

## Contract and data additions

- Repeated uploads for one request/contact/submission become immutable numbered versions with an
  explicit latest marker; older authorized versions remain downloadable.
- Add file comments with author role/id and timestamps.
- Add immutable session-content revisions for title/description, editor, timestamp, and restore
  source. Restore inserts a new revision and updates the current session content atomically.
- Add asynchronous file-export jobs and an R2 artifact that contains only the latest selected
  versions, optionally grouped by session or speaker.

## Implementation sequence

1. Land additive version/comment/revision/export schema and representative seed history.
2. Extend upload finalization and queries with monotonic version numbers and latest selection.
3. Build organizer/speaker version and comment panels with existing file authorization.
4. Build central Files view and deliverables filters by task, speaker, due/completion state, request,
   date, and version; add selected/filtered reminder action through M34/M36.
5. Record revisions on organizer session edits, add history/diff metadata and restore, and preserve
   draft/published as the public approval gate.
6. Add asynchronous latest-files ZIP generation, progress/result UI, expiry, and cleanup.

## Acceptance criteria

- Upload the same PDF twice and see versions 1/2 plus a single latest marker from both roles; the
  older version remains authorized and downloadable.
- Exchange a speaker comment and organizer reply with correct author/timestamps.
- Filter outstanding deliverables, bulk-remind the visible selection, and verify count/outbox/log.
- Edit session content twice, inspect attributed history, restore the earlier content as a new
  revision, publish it, and observe the public update without leaking a draft.
- Edit speaker bio/headshot from organizer detail through the existing contact/file paths.
- Generate and inspect a ZIP containing only latest selected files with the requested grouping and
  no deselected or cross-event object.

## Guardrails

- Never overwrite or reuse an R2 object as a new version; immutable metadata points to immutable keys.
- File comments are plaintext and authorization matches the underlying file.
- Latest selection is server-derived; clients cannot mark arbitrary cross-request versions latest.
- Restore uses one SQL statement/CTE through `neon-http`; do not add another `withTx` function.
- Export jobs re-check event/file authorization server-side and use collision-safe sanitized names.
