# M51 — Standalone speaker roster operations

| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED (rev. 11 / PR #94)**, no active claim. Implemented end to end on the contacts single-writer API (`getOrCreateContact`/`updateContactFields`) and the M34 outbox, via additive migration `drizzle/0008_speaker_roster_operations.sql` (`contacts.workflow_status`, `speaker_logistics_fields`/`speaker_logistics_values`, `contact_unavailability`, `speaker_bulk_messages`): `createSpeaker`/`updateSpeakerProfile`, logistics fields, `replaceSpeakerUnavailability` (event-timezone in/out, atomic full-set replace), `importSpeakersCsvIn` (dependency-free RFC-4180 parser, preview/commit share one diff pass), speaker invite composed through M06b's `requestPortalLogin`, and `composeBulkSpeakerEmailIn`. UI: Add-speaker/Import-CSV dialogs, page-local bulk selection with compose/preview, and `<SpeakerRosterPanels>` (pipeline status, logistics, unavailability editor, uploaded-files panel) on the speaker detail page. Remaining before `DONE`: the deployed browser path — `e2e/speaker-content-ops.spec.ts` has real step bodies but `landed.ts` keeps `M51: false` until the preview is redeployed with migration 0008 applied; real Resend delivery of `speaker_bulk_message` and bundle-size impact are also unverified. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-D leads roster/profile/assets; WS-F owns bulk compose/logging; WS-A reviews additive schema. |
| **Scheduled** | Post-R3 product-completeness wave, parallel with M50/M52/M53. |
| **Size** | L; split roster/import from invitations/bulk communication. |
| **Paths owned** | `src/features/portal/admin/**`, `src/features/portal/server/contacts.ts` (through its single-writer API), `src/features/comms/**`, corresponding admin routes, additive migrations, and `e2e/speaker-content-ops.spec.ts`. |

## Objective

Make Speakers a first-class organizer workflow instead of only a projection of CFP submissions.
Organizers can add, edit, import, invite, filter, and communicate with speakers while preserving the
same event-scoped contact identity used by CFP, portal, tasks, files, and sessions.

## Dependencies

- **Hard:** M06b portal auth/token delivery, M07 files, M22 profile writes, M27 speakers admin,
  M34 outbox, M37 comms UI, and M41 edit-until-close.
- **Ownership:** all contact writes must extend `getOrCreateContact`/`updateContactFields`; no direct
  contact mutation is permitted outside the existing owner.

## Contract and data additions

- Organizer-authorized `createSpeaker`, field-scoped `updateSpeaker`, and `importSpeakersCsv`.
- Editable name, normalized email, title, company, bio, social links, headshot, and workflow status.
- Event-scoped organizer-defined text/select logistics fields and per-contact values.
- Event-scoped `contact_unavailability` rows with `(contact_id, starts_at, ends_at, reason)`, a
  composite event-scoped contact FK, and `ends_at > starts_at`. No rows means no declared blackout;
  intervals are displayed and edited in the event timezone but stored as UTC. Export
  `listSpeakerUnavailability(eventId, contactIds): SpeakerUnavailability[]` and a full-set,
  event-scoped `replaceSpeakerUnavailability(eventId, contactId, intervals)` mutation. The mutation
  uses one guarded CTE so add/edit/remove cannot leave a partial set. M54 consumes the read contract
  rather than scraping logistics text or reaching around the contact owner.
- `inviteSpeaker` issues a fresh portal-login challenge through M06b and enqueues it through M34.
- `composeBulkSpeakerEmail` accepts selected/filtered contacts, template/body, merge data, and a
  preview recipient; it returns queued/skipped/error counts.

## Implementation sequence

1. Land additive logistics-field and unavailability schema/contracts; seed mixed
   complete/incomplete speakers and one speaker with a blackout inside an event day.
2. Add manual create and full organizer edit through the contact single-writer API.
   The speaker editor includes add/edit/remove controls for zero or more blackout intervals.
3. Add CSV upload, column mapping, validation preview, row-level errors, and idempotent upsert by
   `(event_id, normalized_email)`.
4. Add explicit portal invitation with confirmation and communication-log link.
5. Show speaker-uploaded assets with filename, uploader, timestamp, type, and authorized
   view/download actions.
6. Add selected/filtered bulk compose with saved template, merge-field picker, per-recipient resolved
   preview, and result counts.

## Acceptance criteria

- Manually add two speakers and persist full profile, workflow-status, and logistics-field edits.
- Add a speaker blackout in the event timezone, reload it unchanged, and retrieve the same UTC
  interval through `listSpeakerUnavailability` for M54.
- Import two existing emails plus one new row without duplicates; invalid rows remain downloadable
  with clear errors and valid rows are committed exactly once on retry.
- Invite a speaker and verify UI confirmation, delivery/log row, and an event-scoped portal session.
- Upload a headshot/document as the speaker and view its metadata/download as an organizer without
  widening another event's access.
- Filter and bulk-send a personalized message, inspect a resolved preview first, and find one log row
  per recipient with accurate queued/skipped totals.

## Guardrails

- Normalized `(event_id,email)` identity is preserved across CFP, import, manual entry, and portal.
- CSV import never overwrites non-empty fields silently; the preview names every proposed change.
- Portal invitation uses the existing encrypted short-lived login payload and token throttles.
- Bulk messages go only through `enqueueEmail`; no direct Resend or communication-log writes.
- Large selected/filtered sends must be chunked through the existing jobs path, not performed in a
  browser request.
- Availability rows are event-scoped contact data owned here. M54 has read-only access through the
  exported query and never infers availability from free-form custom-field values.
