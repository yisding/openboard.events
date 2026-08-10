# M54 — Assisted agenda placement

| | |
|---|---|
| **Status** | NOT STARTED — begins after M30 and M51 are green. |
| **Workstream / executing agent** | WS-E (Agenda). |
| **Scheduled** | Post-M30/M51 product-completeness wave. |
| **Size** | S |
| **Paths owned** | `src/features/agenda/lib/suggest-placements.ts`, agenda auto-place UI, existing agenda API composition, tests, and `e2e/agenda-schedule.spec.ts` extension. |

## Objective

Reduce manual scheduling work with a deterministic, explainable placement suggestion. One action
previews conflict-safe slots for unscheduled sessions; the organizer can apply accepted suggestions
through the existing `moveSession` mutation and see why any session could not be placed.

## Dependencies

- **Hard:** M04's half-open interval helper, M28 sessions/tray, M29 conflict engine, M30 placement UI
  and `moveSession` integration, and M51's structured speaker-unavailability schema/editor/query.
- Event days, rooms/capacities, session durations, originating-submission capacity, existing
  placements, and
  `listSpeakerUnavailability(eventId, contactIds)` must be available through their owning contracts
  before this module starts. M54 reads them; it does not add a second availability store or editor.

## Algorithm and interface

`suggestPlacements(input)` is a pure deterministic greedy planner:

1. Sort unscheduled sessions by fewest legal slots, then duration descending, then stable id.
2. Enumerate M30's event-day 15-minute grid slots in chronological room-sort order.
3. Build a temporary scheduled-session value for each candidate and call M29's `detectConflicts`
   against existing placements plus suggestions already chosen; any room/speaker error rejects it.
   Use M04's shared half-open `overlaps` helper to reject a candidate that overlaps one of that
   speaker's M51 blackout intervals. Also reject outside-event and invalid-duration candidates. For
   capacity, expose `expectedAttendance: number | null` on the planner DTO by joining the session's
   originating submission `capacity`; reject only when both it and `room.capacity` are non-null and
   expected attendance exceeds the room. Manual sessions or rooms without a value are unconstrained
   rather than guessed.
4. Choose the first legal candidate and include it in subsequent conflict checks.
5. Return placed suggestions plus unplaced reason codes; identical input produces identical output.

The UI shows placed/unplaced counts, proposed day/time/room, reasons, per-row acceptance, and Apply.
Apply first re-reads the schedule and blackout inputs and skips proposals that are no longer legal,
then calls `moveSession` for accepted rows. It surfaces each mutation's authoritative returned
conflicts as well as stale CAS failures, so a race can never become a silent conflict, and it does
not discard independent rows from the preview.

## Acceptance criteria

- With at least two unscheduled sessions, one click produces a deterministic preview and applying it
  persists at least one day/time/room across reload.
- No proposed result silently introduces a speaker or room overlap; the seeded session whose speaker
  is blacked out for the candidate window and capacity-constrained sessions remain unplaced with a
  useful reason.
- Re-running on unchanged data produces the same proposal.
- A concurrent edit to the affected row causes its `moveSession` CAS to fail visibly; an edit to a
  different row that occupies a proposed slot is caught by the apply preflight or surfaced from the
  authoritative post-move conflict result, while independent accepted rows still apply.
- The extended deployed browser spec covers preview, selective apply, persistence, and reason display.

## Guardrails

- The planner is pure and does not write. `moveSession` remains the only scheduling mutation and the
  only place that opens its existing audited transaction.
- Never reimplement room/speaker conflict detection: candidates go through M29. Blackout checks use
  M04's shared half-open `overlaps` helper rather than a second interval predicate.
- Speaker availability is read only through M51's event-scoped query. No rows means no declared
  blackout; overlapping rows reject the candidate. M54 neither guesses from logistics fields nor
  mutates availability.
- Model-generated optimization may be added later, but the deterministic planner is always available
  and is the release path.
