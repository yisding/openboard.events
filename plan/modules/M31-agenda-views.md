# M31 — Week/Track/Room/Conflicts views
| | |
|---|---|
| **Status** | IN PROGRESS — PR #4 contains fixture-backed **STACK-DEMO** Week/Track/Room/Conflicts views; server data, required interactions, accessibility, and AC remain open and are paused behind the minimum loop. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-E (Agenda + Public/Embeds) |
| **Scheduled** | Split: Conflicts tab lands Monday (same day as ./M30-day-grid-dnd.md); Week/Track/Room land Tuesday AM |
| **Size** | M |
| **Paths owned** | `src/features/agenda/components/conflicts-view.tsx`, `week-view.tsx`, `track-view.tsx`, `room-view.tsx` (real implementations — were placeholders created by ./M28-sessions-crud.md; this module owns their contents from here on), `src/features/agenda/components/grouped-agenda-list.tsx` (new shared internal helper, used by `track-view.tsx`/`room-view.tsx` only) |

## Objective
Four read-only projections of the exact same session data the Day grid drags: a Conflicts report (the authoritative badge + fix-it list), a Week overview (event days side by side), a Track lane view, and a Room-by-room agenda. No new writes, no new server functions — this module is entirely presentational, closing out the brief's "list, day, week, track, or room" views claim plus the dedicated Conflicts tab. When done: an organizer can flip through all six tabs, see the seeded conflicts listed with working jump-to links, and watch the badge drop to zero after fixing them in Day view.

## Dependencies
- **Hard (blocks start):** ./M28-sessions-crud.md — `listSessions`, `AgendaViewProps`, and the four placeholder files this module replaces, all complete (solid dependency, done by Sunday AM — well before this module's Monday start). ./M29-conflict-engine.md — the `Conflict`/`ConflictDTO` shape this module renders (done Saturday).
- **Soft (start against stub/fixture):** none. By the time this module starts (Monday for Conflicts, Tuesday AM for the rest), M28 and M29 are both real and solid per the dependency graph — there is no fixture-swap step here.

## Provides (interfaces others consume)
```ts
// src/features/agenda/components/{conflicts,week,track,room}-view.tsx
// each implements AgendaViewProps (from M28's index.client.ts) — no exported functions beyond the default component
```
This module is a UI leaf like ./M30-day-grid-dnd.md. It is, however, consumed indirectly by ./M10-e2e-release.md's `agenda-schedule.spec`, which asserts the Conflicts tab badge count directly (create two overlapping sessions via the edit dialog → badge = 1 → make them back-to-back → badge = 0) — keep the badge's DOM stable and the count trivially selectable (e.g. a `data-testid="conflicts-badge"` element) for that spec.

## Step-by-step implementation

### Monday: Conflicts tab
1. **`conflicts-view.tsx`.** Render `props.conflicts` (already server-computed by M28's page-level query — this module never calls `detectConflicts` itself) as a list, one row per conflict: severity-colored left border/icon (`error` = red, `warning` = amber), kind label ("Room conflict" / "Speaker conflict" / "Track conflict"), the two session titles (look them up from `props.sessions` by `conflict.a`/`conflict.b` id), the overlap range formatted via `formatInZone(overlapStartMs, tz)`–`formatInZone(overlapEndMs, tz)` (always shows the zone label per `time.ts`'s contract), and a "Jump to Day" link (`next/link` `href` to `?view=day&day=<eventDayKey of the overlap, in event tz>`, preserving `eventId` in the path). Group errors above warnings; within each severity, sort by overlap start time (the array from `detectConflicts` is already deterministically ordered — if you need a different display order, re-sort a copy, never mutate the prop). Empty state (`props.conflicts.length === 0`): a calm "No conflicts — nice work" `<EmptyState>`, not a bare blank panel.
2. **Badge wiring note (no file edit needed here):** the tab bar's "Conflicts" badge count is `props.conflicts.length`, rendered by M28's `agenda-toolbar.tsx`/`agenda-page.tsx` (which already receives the same `AgendaViewProps.conflicts` array passed to every view) — this module does not touch that file; it only builds the list content shown when the tab is active. If the badge isn't yet wired when this step starts, that's a one-line addition to M28's already-built toolbar (same array, already in scope there), not new work for this module.
   **Done when:** the two seeded "⚠ Demo conflict A/B" pairs render as two rows with correct kind labels and working jump-to links; navigating via a jump-to link lands on Day view with that day's tab selected.

### Tuesday AM: Week / Track / Room
3. **`grouped-agenda-list.tsx`** — one internal component shared by Track and Room views (not exported outside this module's own files): props `{ sessions: ScheduledSessionDTO[]; groupBy: 'track' | 'room'; tracks: TrackDTO[]; rooms: RoomDTO[]; tz: string }`. Filters to scheduled sessions only (`startsAt != null` — unscheduled rows never appear in any of these three views, they belong to List + tray per the simplification doc), groups by `trackId`/`roomId`, renders one lane per group **plus** a trailing "Uncategorized" (track) / "Unassigned" (room) lane for null-grouped sessions using `<Dash>`-style muted styling — never drop null-grouped sessions silently. Within each lane, sort by `(eventDayKey, startsAt)` and show a day-label chip per item since a lane can span multiple event days.
4. **`track-view.tsx`** — thin wrapper: `<GroupedAgendaList groupBy="track" .../>`, lane header = track color chip + name.
5. **`room-view.tsx`** — thin wrapper: `<GroupedAgendaList groupBy="room" .../>`, lane header = room name (+ capacity if set, via `<Dash>` when absent).
6. **`week-view.tsx`** — one column per event day (loop `eventStartsAt`..`eventEndsAt` via `addDuration(cursor, 'P1D')` + `eventDayKey`, same pattern M30's day-tabs uses — this is a small, acceptable duplication of a 4-line loop rather than a cross-module import, since the loop is trivial and keeping this module's files fully independent of M30's avoids any shared-file ownership question). Each column lists that day's scheduled sessions chronologically (time range, title, room chip, track chip, speaker initials) — this is a **list projection, not a pixel-positioned grid**; it does not reuse Day view's grid math, deliberately, to stay simple and read-only. Column header shows the date formatted via `formatInZone` (day + weekday, e.g. "Tue, Oct 13"). A day with zero scheduled sessions shows a small "Nothing scheduled" note in its column, not an empty void.
   **Done when:** all three views render the seeded 3-day, ~15-session schedule with sessions in the right day/track/room buckets; an unscheduled seeded session appears in none of the three (confirm by counting — total sessions shown across all lanes/columns should equal the scheduled-only count, not the full seed count).

## Acceptance criteria
Copied from catalog: all five brief views + Conflicts switchable; fixing the seeded conflicts drops badge to 0; jump-to navigates to the Day view at the right day.

Verification:
- Manual: click through `?view=list|day|week|track|room|conflicts` on the seeded event — every tab renders without error.
- Manual: fix both seeded conflicts in Day view (drag one pair to non-overlapping times, or edit the other to a different room), reload the agenda page — Conflicts badge reads 0, `conflicts-view.tsx` shows the "no conflicts" empty state.
- `playwright: agenda-schedule.spec` (owned by M10) — create two overlapping sessions via the dialog, assert badge = "1"; edit to back-to-back, assert badge = "0"; this spec is the automated proof for this module's core claim.
- Manual on a phone-width viewport: Week/Track/Room columns/lanes stack sanely (single-column scroll, no horizontal overflow of the page body) — these are read-only lists, not grids, so this should be nearly free, but confirm.

## Guardrails
- **This module never calls `detectConflicts` itself and never queries the DB** — it is strictly a renderer of props already computed by M28's page-level load. If a conflict count looks wrong, the bug is in M28's query wiring or M29's algorithm, not here; do not "helpfully" add a second conflict computation to cross-check — that's exactly the parallel-implementation drift R12 exists to prevent.
- **No mutations anywhere in these four files** — no `useMutation`, no POST/PATCH/DELETE calls, no edit affordances beyond the jump-to-Day link. If an organizer needs to fix a conflict from this view, the fix happens by navigating to Day view (drag) or opening the session dialog (M28) from there — never inline here.
- **Nullable-render rule (R10)**: every lane/column that can be empty (a track with no sessions today, a room with nothing scheduled, an event day with zero sessions) renders a designed empty note, never a blank gap or a crash on `undefined.map`.
- **Timezone**: day bucketing and all displayed times go through `eventDayKey`/`formatInZone` from `time.ts` — the same rule as every other agenda module. A session at 11pm event-tz must land in the correct day column even if its UTC date has already rolled over.
- **Unscheduled sessions are excluded from Week/Track/Room** (they only ever show in List view and the tray) — filtering happens once in `grouped-agenda-list.tsx` and in `week-view.tsx`'s own filter; do not let a null-time row leak into a lane's pixel/position math (there is none here — these are lists — but a null `startsAt` must still not crash the sort comparator; guard the sort key extraction).
- **Deterministic conflict ordering matters for this view specifically**: since `conflicts-view.tsx` renders the array directly as a list with links, an unstable order from M29 would show as visible reordering flicker on refetch — if that's ever observed, it's a bug in M29's canonicalization step, report it there rather than re-sorting defensively here in a way that masks the root cause (a light stable re-sort by severity/time as described in Step 1 is fine and expected; silently deduping or reordering beyond that is not).

## If blocked
- Tuesday is the perf-and-hardening day per the timeline — if Week/Track/Room are done early, help verify the public pages' (./M32-public-schedule-gallery.md) cache headers and bundle-size gate, since that's explicitly called out as Tuesday work for this workstream's shared concerns.
- Add small polish the AC doesn't require: a track/room filter chip row reusing M28's existing filter state (read-only consumption of `filters.trackId`/`filters.roomId`, no new mutation), or a "jump to Week" link from a session card back the other direction.
- Re-verify the Conflicts tab's jump-to link against every seeded conflict pair, not just the two named ones, if the seed grows additional incidental overlaps during later seed-script iterations (M09 seed v2/v3 land Sunday/Tuesday) — this view's correctness should hold for however many conflicts exist, not just the two originally named ones.
- If Day view (M30) slips, this module can still finish independently — its only dependency on M30 is that both consume the same `AgendaViewProps`/`Conflict` shapes, already frozen since M28/M29. Proceed on schedule regardless of M30's status.
