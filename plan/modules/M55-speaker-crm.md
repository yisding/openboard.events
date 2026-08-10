# M55 — Organization-level Speaker CRM

| | |
|---|---|
| **Status** | NOT STARTED — **BLOCKED on tenancy (rev. 11)**, no active claim, no code added. The rev. 11 run (PR #94) skipped M55 outright ("M43/M44/M51 not all complete"); M51 is now merged, so the remaining blocker is organization tenancy — M43 (org tenancy schema) and M44 (user management) — which are themselves blocked on M42's Better Auth spike, currently on hold pending explicit owner re-authorization (see [`../status.md`](../status.md) §2f). Optional commercial expansion; never blocks the core release. |
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
