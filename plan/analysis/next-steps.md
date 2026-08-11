# Next steps: release closure and product hardening

This document is the short execution overlay for the current tree. It turns the
remaining implementation and verification debt into an ordered queue. Existing
module work orders remain authoritative for contracts, ownership, and detailed
implementation steps.

## Current state

The core server-backed paths are now present across CFP intake, review, speaker
operations, portal tasks, agenda scheduling, public pages, embeds, and the
organization CRM. The remaining work is concentrated in a small number of
integration defects and deployment proofs:

- The public CFP wizard still submits only the primary participant. Co-speaker
  entry and role persistence need to be completed.
- Draft restoration works at the server boundary, but the speaker-facing resume
  state needs a clear, deliberate UI path.
- File presign → PUT → finalize completes, but the subsequent task attachment
  request does not reliably refresh the task's visible upload state.
- The review, speaker-roster, and deliverables flows need a clean reset/reseed and
  redeployed run after their latest seed and UI changes.
- Assisted agenda placement needs a two-tab stale-write proof; public surfaces
  need a final phone, keyboard, cache, and cross-origin pass.
- The organization CRM has its first complete UI/API pass, but still needs a
  focused browser run and a tested recovery story for merges.

## Ordered work queue

### 1. Close the upload attachment loop

Owner: M25/M52 portal task runtime and deliverables owners.

1. Reproduce the failure in `TaskDetailView.attach()` with a real file asset.
2. Make the attachment request surface its HTTP error instead of silently
   returning to the page.
3. Refresh or replace the task detail data only after the attachment mutation
   succeeds; show the new version, latest marker, and completion state immediately.
4. Add a regression test for the complete sequence: presign, upload, finalize,
   attach, reload, and organizer visibility.
5. Run the existing speaker-content flow against a real R2 binding.

Done when a speaker's first upload appears in the task detail without a manual
reload, the organizer can inspect/download it, and a second upload displays both
versions with exactly one marked latest.

### 2. Finish participant and draft UX

Owner: M15, with M16/M17 contracts unchanged.

1. Add repeatable co-speaker rows to the participant step: name/email, role, order,
   and primary-participant semantics.
2. Validate duplicate emails, missing names, and the single-primary invariant in
   the browser and on the server.
3. Keep participant answer normalization in the existing submit pipeline; do not
   add a second participant write path.
4. Make the saved-draft state explicit: show when the draft was last saved and
   offer a clear resume path after the speaker authenticates again.
5. Cover close-date behavior for both draft saves and edits, including the exact
   deadline boundary.

Done when a proposal with a co-speaker survives reload, appears with role labels
in organizer review, and a speaker can leave and return to an unmistakable saved
draft without losing answers.

### 3. Re-run the review and roster paths from a clean database

Owner: M09/M50/M51/M37.

1. Redeploy the current `main` tree, including the latest additive migrations.
2. Wipe and reseed `sb-test` using the current seed order.
3. Verify every seeded reviewer has the contact row required for reminder
   delivery; keep that invariant in the seed test.
4. Make roster setup idempotent: repeated runs must not duplicate logistics
   fields, contacts, or invitations.
5. Run the review flow end to end: two rounds, typed review rules, blind answers,
   explicit assignments, progress, recusal, and reminder dispatch.
6. Run the speaker flow end to end: add, import, invite, profile, availability,
   bulk communication, and uploaded-asset inspection.

Done when a fresh reset produces the same usable reviewer/roster fixture twice,
reminders are queued for real recipients, and both flows complete without relying
on stale preview data.

### 4. Complete agenda and public-surface verification

Owner: M28–M33/M54.

1. Add a two-tab drag/move test proving one stale `moveSession` write returns a
   typed conflict, rolls back the client, and leaves the winner intact.
2. Run the schedule builder through list, day, week, track, room, and conflicts
   views using the same seeded rows.
3. Verify assisted placement previews legal slots, explains blocked rows, and
   applies through the existing CAS mutation.
4. Exercise all five public surfaces on a narrow viewport with keyboard-only
   navigation, search/filter/day/detail interactions, and return-state checks.
5. Render each embed from a separate origin and verify resize messaging, disabled
   state, publication filtering, cache headers, and the non-embed security header.
6. Compare a changed session and speaker across the organizer page, direct public
   pages, and embeds after the cache window.

Done when the current deployed artifact demonstrates consistent data and safe
interaction across the admin, public, and embedded surfaces.

### 5. Prove the operational tails

Owner: M34–M40 and release owner.

1. Run the reminder scan twice and verify no duplicate sends; verify the manual
   reminder path and communication log.
2. Complete the calendar invite lifecycle in real Gmail and Outlook mailboxes:
   request, reschedule with sequence increment, and cancel.
3. Verify the dashboard's outstanding-task count drops after a portal completion
   and that every deep link lands on the fixing surface.
4. Exercise keyed API reads with a second event and confirm private/public cache
   behavior and draft exclusion.
5. Run the worker-size, client-bundle, invariant, typecheck, lint, unit, build,
   migration, and post-deploy smoke gates from a clean checkout.

Done when external integrations, background jobs, and release gates have current
artifacts rather than historical notes.

### 6. Finish the organization CRM pass

Owner: M55, after the required release paths are stable.

1. Run the directory, multi-filter, profile/history, tags/custom fields, CSV
   import, merge, pipeline, segments, event push, bulk email, and metrics flows.
2. Add a focused browser spec covering the highest-risk transitions: import
   retry, merge preview/commit, pipeline movement, and event push.
3. Document the merge recovery procedure and add a tested audit lookup for every
   merge.

Done when the CRM UI and API agree after reload, every mutation is organization
scoped, and a merge can be investigated from its audit record.

## Release order

The critical path is:

```text
upload attach fix
  → clean seed/redeploy
  → review + roster + deliverables runs
  → agenda/public verification
  → operational tails
  → CRM verification
```

Do not spend release time on new commercial scope while the upload handoff,
reviewer seed, or fresh-deployment runs remain unresolved. Keep all cross-feature
changes on the existing single-writer paths and reuse the established outbox,
publication-query, task-assignment, and CAS boundaries.

## Release checklist

- [ ] Current `main` deployed with all pending migrations.
- [ ] Fresh `sb-test` reset/reseed is repeatable.
- [ ] CFP co-speaker and draft-resume flows complete.
- [ ] File attachment and versioning flow completes across speaker and organizer.
- [ ] Review, roster, and deliverables flows pass from the fresh seed.
- [ ] Agenda conflict, assisted placement, and stale-write checks pass.
- [ ] Five public surfaces and embeds pass phone/keyboard/cross-origin checks.
- [ ] Email, calendar, reminder, dashboard, API, and R2 evidence is current.
- [ ] Full validation and post-deploy smoke gates pass.
- [ ] CRM browser pass and merge audit checks are complete.
