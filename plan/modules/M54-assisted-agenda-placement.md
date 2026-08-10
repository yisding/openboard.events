# M54 — Assisted agenda placement

| | |
|---|---|
| **Status** | NOT STARTED — begins after M30 is green. |
| **Workstream / executing agent** | WS-E (Agenda). |
| **Scheduled** | Post-M30 product-completeness wave. |
| **Size** | S |
| **Paths owned** | `src/features/agenda/lib/suggest-placements.ts`, agenda auto-place UI, existing agenda API composition, tests, and `e2e/agenda-schedule.spec.ts` extension. |

## Objective

Reduce manual scheduling work with a deterministic, explainable placement suggestion. One action
previews conflict-safe slots for unscheduled sessions; the organizer can apply accepted suggestions
through the existing `moveSession` mutation and see why any session could not be placed.

## Dependencies

- **Hard:** M28 sessions/tray, M29 conflict engine, M30 placement UI and `moveSession` integration.
- Speaker availability, event days, rooms/capacities, durations, and existing placements must be
  available through existing agenda contracts before this module starts.

## Algorithm and interface

`suggestPlacements(input)` is a pure deterministic greedy planner:

1. Sort unscheduled sessions by fewest legal slots, then duration descending, then stable id.
2. Enumerate configured event-day/room slots in chronological room-sort order.
3. Reject speaker overlap/unavailability, room overlap/capacity, outside-event, and invalid-duration
   candidates using M29's conflict primitives.
4. Choose the first legal candidate and include it in subsequent conflict checks.
5. Return placed suggestions plus unplaced reason codes; identical input produces identical output.

The UI shows placed/unplaced counts, proposed day/time/room, reasons, per-row acceptance, and Apply.
Apply calls `moveSession` for accepted rows and reports stale/conflicting rows without discarding the
rest of the preview.

## Acceptance criteria

- With at least two unscheduled sessions, one click produces a deterministic preview and applying it
  persists at least one day/time/room across reload.
- No proposed result silently introduces a speaker or room overlap; unavailable/capacity-constrained
  sessions remain unplaced with a useful reason.
- Re-running on unchanged data produces the same proposal.
- A concurrent edit causes the affected `moveSession` CAS to fail visibly while independent accepted
  rows still apply safely.
- The extended deployed browser spec covers preview, selective apply, persistence, and reason display.

## Guardrails

- The planner is pure and does not write. `moveSession` remains the only scheduling mutation and the
  only place that opens its existing audited transaction.
- Never bypass M29 or create a second conflict implementation.
- Model-generated optimization may be added later, but the deterministic planner is always available
  and is the release path.
