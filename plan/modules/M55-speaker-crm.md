# M55 — Organization-level Speaker CRM

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED (rev. 12 / PR #95), partial — core landed**, no active claim. Tenancy unblocked at rev. 12 (M43/M44 both merged); the CRM server/contracts layer landed on top via additive migration `drizzle/0013_speaker_crm.sql` (11 tables: an organization-level `organization_contacts` identity distinct from event-scoped `contacts`, links, tags, custom fields, notes, an append-only activity timeline, saved dynamic segments resolved fresh on every read, an immutable merge audit table, and a three-stage open/won/lost pipeline). 16 API routes under `/api/internal/organizations/[organizationId]/crm/**`, all `organizationAuth()`-scoped; directory search/filter, CSV import with org-aware duplicate detection, a merge engine (preview + audited `withTx` commit), push-to-event reuse of M51's `getOrCreateContact`, and bulk email delegated to M51's `composeBulkSpeakerEmailIn` (no second sender). 6 PGlite integration tests. Remaining before `DONE`: **no UI was built** — no directory page, merge wizard, segment builder, pipeline kanban, or CSV import wizard, all deliberately left as the next pass's scope; the merge audit's recovery procedure is documented but not an automated/tested "unmerge" mutation; migration `0013` is applied to `sb-dev`/`sb-test` but the preview has not been redeployed with this code, so no route has deployed/browser evidence. See [`../status.md`](../status.md) §2g. |
| **Workstream / executing agent** | Product lane assigned after organization tenancy and M51. |
| **Scheduled** | After M43, M44, and M51. |
| **Size** | XL; split directory/merge, history/segments, pipeline, and communication/metrics. |
| **Paths owned** | `src/features/crm/**`, organization-level CRM routes/APIs, additive migrations, and CRM browser specs. |

## Objective

Turn event-scoped speaker operations into an organization-wide relationship system. Teams can find
and reuse speakers across events, preserve history, manage duplicates, segment and communicate with
contacts, and track a sourcing pipeline without copying data into a disconnected store.

## Dependencies

- **Hard:** M43 organization tenancy, M44 user/role management, M51 event speaker operations.
- **Communication:** M37 for existing compose/log behavior and M46 for productized suppression,
  unsubscribe, and large-send controls.

## Scope

- Searchable organization directory with multi-criteria filters, tags, custom fields, internal
  notes, activity, and event/session history.
- CSV import with preview/errors and organization-aware duplicate detection.
- Explicit duplicate merge with chosen primary, field-by-field conflict resolution, reference
  reassignment, immutable audit record, and rollback plan before destructive consolidation.
- Saved dynamic segments and selected/segment bulk communication through the existing comms path.
- Sourcing kanban with open/won/lost lifecycle and timestamped transitions.
- Push a contact into an event through M51 without re-entry or duplicate creation.
- Organization-wide directory, engagement, reuse, and pipeline metrics.

## Acceptance criteria

- Search/filter across at least two events and inspect a contact's complete event/session/activity
  history without leaking another organization.
- Import a mixed CSV, resolve a duplicate, merge it into an explicit primary, and preserve all event,
  session, note, tag, and communication references with an audit record.
- Save a dynamic segment, observe membership change after an underlying field edit, and bulk-compose
  to it with suppression/unsubscribe enforcement.
- Move a prospect through open/won/lost states and verify timestamped history and aggregate metrics.
- Push an existing organization contact into a new event; M51 shows the speaker without duplicating
  the organization identity.

## Guardrails

- Organization scope is enforced in every query and mutation, not inferred from the active UI.
- Event contacts remain the operational records used by CFP/portal/tasks; CRM introduces an explicit
  organization identity/link rather than silently collapsing event rows.
- Merge is a high-risk operation: require preview, explicit primary, reference counts, audit trail,
  and a tested recovery procedure before enabling it.
- All email uses the existing outbox/compliance path; CRM never imports a second sender.
