# M29 — Conflict engine
| | |
|---|---|
| **Status** | IN PROGRESS — **MERGED** ([PR #89](https://github.com/yisding/symmetrical-happiness/pull/89)), and its remaining "no server caller" item is now satisfied by the rev. 10 run. Steps 1–3 are done: `conflicts.ts` speaks the frozen contract — `ScheduledSession` in epoch milliseconds, `toScheduledSession` returning `null` for NULL-time rows, and `detectConflicts` returning `ConflictDTO[]` (`a`/`b`/`subjectId`/`overlapStartMs`/`overlapEndMs`) from a per-subject sweep — with deterministic result ordering (`148931f`). The suite is 10+ cases including the strict half-open back-to-back guard, one-conflict-per-colliding-subject, three-way room pile-ups and order independence. [M28](./M28-sessions-crud.md)'s `getSchedulableSessions` (`src/features/agenda/server/queries.ts`) now exists and is called from the real `src/app/events/[eventId]/agenda/page.tsx`, so a real server caller consumes this engine — verified by `grep -rn "getSchedulableSessions" src/`. **Remaining before `DONE`:** step 4's randomized property test, and deployed/browser AC. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-E (Agenda + Public/Embeds) |
| **Scheduled** | Original target: Fri night → Sat AM. Current gate: reconcile the merged slice with frozen contracts and make the full property/acceptance suite green before conflict-dependent M28/M30/M31 work consumes it. |
| **Size** | S |
| **Paths owned** | `src/features/agenda/conflicts.ts`, `src/features/agenda/conflicts.test.ts` |

## Objective
A pure, dependency-free function `detectConflicts(sessions): Conflict[]` that finds room, speaker, and track overlaps across a schedule using half-open interval math. It has no DB, no React, no time-zone code — just numbers in, conflicts out. When done, the function is fully spec'd by its test file and ready for M28 (server-side authoritative recompute) and M30 (client-side live outlines) to import as-is.

## Dependencies
- **Hard (blocks start):** none beyond `@/shared/contracts` existing with placeholder branded-id types (`SessionId`, `RoomId`, `TrackId`, `ContactId`) and the `ScheduledSessionDTO`/`ConflictDTO` shapes. This module starts **Friday night** against the M02 contracts **draft** (not the frozen version) — branded-id types are stable enough on day 0 that this is safe; if a field renames before freeze, it's a 5-minute fixup.
- **Soft (start against stub/fixture):** none needed — this is pure logic with no data dependency. If `@/shared/contracts` isn't pushed yet, hand-roll the two local types shown below and delete them once the real import lands.

## Provides (interfaces others consume)
```ts
// src/features/agenda/conflicts.ts
export type ScheduledSession = {
  id: SessionId;
  startsAtMs: number;          // epoch ms — caller converts from timestamptz; no tz math in here
  endsAtMs: number;
  roomId: RoomId | null;
  trackId: TrackId | null;
  speakerIds: readonly ContactId[];
};

export type Conflict = {
  kind: 'room' | 'speaker' | 'track';
  severity: 'error' | 'warning';       // room, speaker = error; track = warning
  a: SessionId;
  b: SessionId;
  subjectId: string;                   // the roomId/contactId/trackId that collides (as string)
  overlapStartMs: number;
  overlapEndMs: number;
};

export function detectConflicts(sessions: readonly ScheduledSession[]): Conflict[];

// helper other modules reuse to build ScheduledSession[] from DTOs, filtering out NULL-time rows
export function toScheduledSession(dto: ScheduledSessionDTO): ScheduledSession | null;
```
PROPOSED (derived from quality-strategy.md §S3, not contradicted anywhere in PLAN.md — this is the exact shape that doc specs for this exact function). `SessionId`/`RoomId`/`TrackId`/`ContactId` and `ScheduledSessionDTO`/`ConflictDTO` come from `@/shared/contracts` (M02).

Consumed by:
- ./M28-sessions-crud.md — `getSchedulableSessions` (server) calls `toScheduledSession` + `detectConflicts` for the authoritative recompute on every `saveSession`/`moveSession` write, and to seed the initial page render's conflict list.
- ./M30-day-grid-dnd.md — runs `detectConflicts` client-side on the optimistic post-drag state for instant red outlines, before the server round-trip confirms.
- ./M31-agenda-views.md — the Conflicts tab lists exactly the array this function returns (badge count = `conflicts.length`).

## Step-by-step implementation

1. **Contract-first: write the types and an empty implementation that compiles.** Create `conflicts.ts` with the `ScheduledSession`, `Conflict` types and a `detectConflicts` stub returning `[]`, plus `toScheduledSession`. Push immediately — M28/M30/M31 can import the types and wire call sites before the real algorithm lands. **Done when:** file compiles, is importable from `@/features/agenda/conflicts` (re-exported via `index.ts` once M28 creates the barrel — until then, direct path import is fine since this file has zero feature-internal dependencies).

2. **Implement `toScheduledSession`.** Return `null` when `dto.startsAt == null || dto.endsAt == null` (NULL-time = unscheduled tray, never enters conflict math). Otherwise `{ id, startsAtMs: Date.parse(dto.startsAt), endsAtMs: Date.parse(dto.endsAt), roomId: dto.roomId ?? null, trackId: dto.trackId ?? null, speakerIds: dto.speakers.map(s => s.contactId) }`. **Done when:** a unit case with a null-time DTO returns `null`; a fully-scheduled DTO returns a well-formed `ScheduledSession`.

3. **Implement `detectConflicts` as a sweep-line per subject.** For each of the three subject kinds:
   - **room**: group sessions by non-null `roomId`.
   - **speaker**: group by each `contactId` appearing in any session's `speakerIds` (a session can appear in multiple speaker groups).
   - **track**: group by non-null `trackId`.

   Within each group: sort by `startsAtMs` ascending; sweep with a small active-set (interval-scheduling style) comparing each session only against sessions still active (i.e. `active.endsAtMs > candidate.startsAtMs`); half-open overlap test is `aStart < bEnd && bStart < aEnd` with **strict** `<` on both sides — this is the one line that must never become `<=` (back-to-back sessions, `end === start`, must NOT conflict). Emit one `Conflict` per overlapping pair with `kind` = the group's subject kind, `severity` = `'error'` for room/speaker, `'warning'` for track, `subjectId` = the group's key (stringified), `overlapStartMs = max(aStart,bStart)`, `overlapEndMs = min(aEnd,bEnd)`.

   Complexity: O(n log n) per subject kind (sort dominates); total O(n log n) — never nested O(n²) loops over the full session list.

4. **Deterministic output.** Before returning, canonicalize every pair so `a` = the lexicographically/numerically smaller session id and `b` = the larger (pick one consistent rule — e.g. string comparison of the UUIDs — and document it in a comment), dedupe identical `(kind, a, b, subjectId)` tuples (a pair can only conflict once per subject-kind-instance; a session can't appear twice in the same room group), then sort the final array by `(kind, a, b)`. This makes repeated calls on the same input byte-identical — required for the "no flickering diffs between client and server runs" AC and for stable React keys in M31's Conflicts list.

5. **Write the test file — this file IS the spec.** `conflicts.test.ts`:
   - **Example table** (≥10 rows, Vitest `it.each`): back-to-back same room (`10:00–10:30` then `10:30–11:00`, same room) → no conflict; identical times same room → conflict; containment (`10:00–11:00` room A contains `10:15–10:30` room A) → conflict; cross-room same speaker, overlapping times → speaker conflict, no room conflict; same track, different rooms, overlapping → one `track` warning, no `room` error; unscheduled session (caller never passes it — verify `toScheduledSession` returns `null` for it, not that `detectConflicts` special-cases it) → excluded upstream; empty input → `[]`; a session with 2 speakers overlapping a session with 1 shared speaker → exactly one speaker conflict for the shared contact, not two.
   - **fast-check properties** (per quality-strategy §S3 — this is the highest-value test in the repo, keep all four):
     1. Result is invariant under permutation of the input array (shuffle input, same conflict set out, after canonical sort).
     2. **Agreement with a ~10-line O(n²) brute-force oracle** implemented inline in the test file (nested loop, same half-open predicate) on randomly generated schedules (random start/duration/room/track/speaker-set per session, 3–15 sessions). This single property catches every boundary mistake for free — do not skip it.
     3. No conflict is ever produced when a fast-check generator constructs intervals guaranteed pairwise-disjoint per subject (construct by laying out non-overlapping `[start,end)` slots then assigning subjects).
     4. No self-pairs (`a !== b` always) and no `(x,y)`/`(y,x)` duplicate pair for the same subject.
   **Done when:** `pnpm vitest run src/features/agenda/conflicts.test.ts` is green, including all 4 fast-check properties running ≥100 cases each with no shrink failures.

## Acceptance criteria
Copied from catalog: all property tests green; seeded back-to-back pair NOT flagged; seeded conflict pairs flagged with correct kind/overlap.

Verification:
- `pnpm vitest run src/features/agenda/conflicts.test.ts` — all example rows + fast-check properties pass.
- Once M09's seed data exists (Sat AM+): a small script or the test file's fixture directly encodes the seed's two named conflict pairs ("⚠ Demo conflict A/B" — one room-overlap, one speaker-overlap per §5 of quality-strategy) and asserts `detectConflicts` flags exactly those two, with the right `kind`.
- `pnpm tsc --noEmit` — no `any`, exhaustive on the `kind`/`severity` unions if any switch is added later (there shouldn't be one in this file).

## Guardrails
- **Half-open `[start, end)` is the whole point of this module** (agenda-embeds.md edge case #1). A naive `startA <= endB && startB <= endA` flags every back-to-back pair — judges *will* schedule sessions back-to-back and this must not turn red. Use strict `<` only.
- **No timezone code in this file, ever.** Inputs are already epoch ms; day-grouping/DST/formatting is the caller's job via `time.ts` (M04, import-restricted — this file must not import `date-fns`/`date-fns-tz`, and the CI grep for those imports outside `time.ts` will catch a violation).
- **Non-blocking by design** (per data-model.md and quality-strategy §S3): this function never rejects a move — it only reports. `moveSession` (M28) always persists a valid CAS'd move and returns the fresh conflict list alongside it; there is no "can't schedule here" hard-block, matching Sessionboard's model and avoiding an unfixable stuck state where every intermediate arrangement is also conflicted.
- **Run it both places**: client-side (M30, on the optimistic post-drag state, for instant feedback) AND server-side (M28's `moveSession`/`saveSession`, authoritative — feeds the Conflicts tab badge in M31). Never trust the client's conflict computation for anything persisted or counted (R12: server-computed truth for anything the client also computes).
- **Deterministic ordering matters beyond aesthetics**: M31's Conflicts tab renders this array directly as a list with "jump to" links; unstable ordering across renders causes visible list-reordering flicker and breaks naive React `key` reuse.
- **Performance**: do not let a later editor "helpfully" replace the sweep with a nested double loop when adding a new subject kind — the O(n²) oracle belongs only in the test file, never in the shipped function (agenda-embeds.md edge case #14). A ~15-session seed schedule won't expose a perf regression by feel; the fast-check property with larger n is the only thing that will.

## If blocked
Never idles — this is the first thing any WS-E agent can build (Fri night, contracts-draft-only dependency). If genuinely stuck waiting on `@/shared/contracts` types:
1. Hand-write the two local types (`ScheduledSession`, `Conflict`) with plain `string` ids instead of branded types, implement and test the full algorithm against them, then do a 5-minute type-only swap once M02 lands.
2. Start drafting M28's `getSchedulableSessions` query signature and the `AgendaViewProps` contract (used by M30/M31) as a design note, so M28's Step 1 is faster once M03's schema lands Sat AM.
3. Extend the fast-check generators to also produce the "unscheduled session mixed into the list" case and confirm `toScheduledSession` filtering (not `detectConflicts`) is what excludes it — a common mistake is duplicating the null-check inside `detectConflicts` itself, which this test should guard against.
