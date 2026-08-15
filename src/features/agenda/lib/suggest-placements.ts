import type { ContactId, RoomId, SessionId, TrackId } from "@/shared/contracts";
import { overlaps } from "@/shared/lib/intervals";
import { detectConflicts, type ScheduledSession } from "../conflicts";
import { SLOT_MINUTES } from "../components/day-view/slots";

/**
 * M54 — the deterministic greedy placement planner.
 *
 * Pure by construction, exactly like M29's `detectConflicts`: epoch
 * milliseconds in, a placement (or a reason it has none) out. No database, no
 * time zone, no `Date` math beyond wrapping a millisecond for the `overlaps`
 * helper's signature — every conversion between an event's wall time and UTC
 * happens in the caller (`server/placements.ts`), through `time.ts`, exactly
 * once. This is what makes "re-running on unchanged data produces the same
 * proposal" true by inspection rather than by luck: nothing here reads a
 * clock, a locale, or an iteration order the caller does not hand it.
 */

export type PlannerRoom = { id: RoomId | null; capacity: number | null; sortOrder: number };

/** One event day's candidate window, already clamped to the event's own
 * start/end by the caller — a candidate is never generated outside either. */
export type PlannerDayWindow = { dayKey: string; startMs: number; endMsExclusive: number };

export type PlannerBlackout = { contactId: ContactId; startsAtMs: number; endsAtMs: number };

/**
 * The planner's per-session DTO (work order §"Algorithm and interface" step
 * 3): `expectedAttendance` is the session's originating-submission capacity,
 * already joined by the caller — `null` for a manual session or one whose
 * submission never declared a capacity, which step 3 says is unconstrained
 * rather than guessed.
 */
export type PlannerSession = {
  id: SessionId;
  title: string;
  trackId: TrackId | null;
  speakerIds: readonly ContactId[];
  expectedAttendance: number | null;
  durationMinutes: number;
};

export type RejectionCounts = { roomOrSpeakerConflict: number; blackout: number; capacity: number };

const EMPTY_REJECTIONS: RejectionCounts = { roomOrSpeakerConflict: 0, blackout: 0, capacity: 0 };

export type UnplacedReason = "invalid_duration" | "no_legal_slot";

export type PlacedSuggestion = {
  sessionId: SessionId;
  dayKey: string;
  startsAtMs: number;
  endsAtMs: number;
  roomId: RoomId | null;
};

export type UnplacedSuggestion = {
  sessionId: SessionId;
  reason: UnplacedReason;
  rejections: RejectionCounts;
};

export type SuggestPlacementsInput = {
  days: readonly PlannerDayWindow[];
  /** Sort order + room-sort-order tiebreak comes from `sortOrder`/`id`, not
   * from array order — the caller may hand these in any order. An empty
   * array means "no rooms configured": the search still runs, over one
   * synthetic unconstrained `roomId: null` slot per time. */
  rooms: readonly PlannerRoom[];
  /** Already-placed sessions this run must never collide with. */
  existing: readonly ScheduledSession[];
  unscheduled: readonly PlannerSession[];
  blackouts: readonly PlannerBlackout[];
};

export type SuggestPlacementsResult = {
  placed: PlacedSuggestion[];
  unplaced: UnplacedSuggestion[];
};

/** The shape `isCandidateLegal` and the search loop share — one instant, one
 * room, one session's identity — built fresh for every slot tried. */
export type PlacementCandidate = {
  sessionId: SessionId;
  startsAtMs: number;
  endsAtMs: number;
  roomId: RoomId | null;
  trackId: TrackId | null;
  speakerIds: readonly ContactId[];
  expectedAttendance: number | null;
};

export type LegalityVerdict = { legal: true } | { legal: false; reason: keyof RejectionCounts };

/**
 * The single legality check every candidate — inside `suggestPlacements`'s
 * own search *and* the apply preflight in `server/placements.ts` — goes
 * through. One function, two call sites, so "no proposed result silently
 * introduces an overlap" cannot drift between preview and apply.
 *
 * Order matches the work order's own listing: room/speaker conflict (through
 * M29's `detectConflicts`, never reimplemented), then a speaker's M51
 * blackout (through M04's shared half-open `overlaps`), then room capacity.
 *
 * Track overlap is deliberately *not* screened: `detectConflicts` grades it
 * `warning` because two sessions of one track running at once is a programming
 * choice, and blocking on it would make a single-track event unplaceable. The
 * auto-place dialog says so rather than promising more than this checks.
 */
export function isCandidateLegal(
  candidate: PlacementCandidate,
  pool: readonly ScheduledSession[],
  blackouts: readonly PlannerBlackout[],
  room: PlannerRoom | null,
): LegalityVerdict {
  const relevant = pool.filter((session) => (
    (candidate.roomId !== null && session.roomId === candidate.roomId)
    || session.speakerIds.some((id) => candidate.speakerIds.includes(id))
  ));
  const synthetic: ScheduledSession = {
    id: candidate.sessionId,
    startsAtMs: candidate.startsAtMs,
    endsAtMs: candidate.endsAtMs,
    roomId: candidate.roomId,
    trackId: candidate.trackId,
    speakerIds: candidate.speakerIds as ContactId[],
  };
  const conflicts = detectConflicts([...relevant, synthetic]);
  const blocked = conflicts.some((conflict) => (
    conflict.severity === "error" && (conflict.a === synthetic.id || conflict.b === synthetic.id)
  ));
  if (blocked) return { legal: false, reason: "roomOrSpeakerConflict" };

  const candidateInterval = { start: new Date(candidate.startsAtMs), end: new Date(candidate.endsAtMs) };
  for (const blackout of blackouts) {
    if (!candidate.speakerIds.includes(blackout.contactId)) continue;
    if (overlaps(candidateInterval, { start: new Date(blackout.startsAtMs), end: new Date(blackout.endsAtMs) })) {
      return { legal: false, reason: "blackout" };
    }
  }

  if (room && room.capacity !== null && candidate.expectedAttendance !== null && candidate.expectedAttendance > room.capacity) {
    return { legal: false, reason: "capacity" };
  }

  return { legal: true };
}

function sortedRooms(rooms: readonly PlannerRoom[]): PlannerRoom[] {
  if (rooms.length === 0) return [{ id: null, capacity: null, sortOrder: 0 }];
  return [...rooms].sort((a, b) => a.sortOrder - b.sortOrder || String(a.id ?? "").localeCompare(String(b.id ?? "")));
}

/**
 * M30's event-day 15-minute grid, in chronological room-sort order: every
 * room at 9:00, then every room at 9:15, and so on — never every slot in one
 * room before moving to the next. `days` is walked in the order the caller
 * gave it; `suggestPlacements` sorts it by `dayKey` before calling this so a
 * caller that handed the days in over any order still searches
 * chronologically.
 */
function* generateCandidates(
  session: PlannerSession,
  days: readonly PlannerDayWindow[],
  rooms: readonly PlannerRoom[],
): Generator<PlacementCandidate> {
  const durationMs = session.durationMinutes * 60_000;
  const stepMs = SLOT_MINUTES * 60_000;
  for (const day of days) {
    for (let startsAtMs = day.startMs; startsAtMs + durationMs <= day.endMsExclusive; startsAtMs += stepMs) {
      const endsAtMs = startsAtMs + durationMs;
      for (const room of rooms) {
        yield {
          sessionId: session.id,
          startsAtMs,
          endsAtMs,
          roomId: room.id,
          trackId: session.trackId,
          speakerIds: session.speakerIds,
          expectedAttendance: session.expectedAttendance,
        };
      }
    }
  }
}

function dayKeyFor(days: readonly PlannerDayWindow[], startsAtMs: number): string {
  const match = days.find((day) => startsAtMs >= day.startMs && startsAtMs < day.endMsExclusive);
  return match?.dayKey ?? days[0]?.dayKey ?? "";
}

/**
 * The whole algorithm (work order §"Algorithm and interface"):
 *
 * 1. Sort unscheduled sessions by fewest legal slots — counted here against
 *    the *fixed* `existing` baseline, before anything from this run is
 *    chosen — then duration descending, then stable id.
 * 2–4. Walk each session's candidates in chronological room-sort order,
 *    testing each through `isCandidateLegal` against `existing` **plus**
 *    every suggestion already chosen this run, and take the first legal one.
 * 5. Return placed suggestions and unplaced reasons. Nothing here is
 *    randomized, memoized across calls, or order-dependent on `Map`/`Set`
 *    iteration beyond what the sorts above already fix, so identical input
 *    produces identical output.
 */
export function suggestPlacements(input: SuggestPlacementsInput): SuggestPlacementsResult {
  const days = [...input.days].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  const rooms = sortedRooms(input.rooms);
  const roomsById = new Map(rooms.map((room) => [String(room.id), room]));

  const withCounts = input.unscheduled.map((session) => {
    if (session.durationMinutes <= 0) return { session, legalSlotCount: 0, invalidDuration: true };
    let legalSlotCount = 0;
    for (const candidate of generateCandidates(session, days, rooms)) {
      const room = roomsById.get(String(candidate.roomId)) ?? null;
      if (isCandidateLegal(candidate, input.existing, input.blackouts, room).legal) legalSlotCount += 1;
    }
    return { session, legalSlotCount, invalidDuration: false };
  });

  const ordered = [...withCounts].sort((a, b) => (
    a.legalSlotCount - b.legalSlotCount
    || b.session.durationMinutes - a.session.durationMinutes
    || String(a.session.id).localeCompare(String(b.session.id))
  ));

  const pool: ScheduledSession[] = [...input.existing];
  const placed: PlacedSuggestion[] = [];
  const unplaced: UnplacedSuggestion[] = [];

  for (const { session, invalidDuration } of ordered) {
    if (invalidDuration) {
      unplaced.push({ sessionId: session.id, reason: "invalid_duration", rejections: EMPTY_REJECTIONS });
      continue;
    }
    const rejections: RejectionCounts = { roomOrSpeakerConflict: 0, blackout: 0, capacity: 0 };
    let winner: PlacementCandidate | null = null;
    for (const candidate of generateCandidates(session, days, rooms)) {
      const room = roomsById.get(String(candidate.roomId)) ?? null;
      const verdict = isCandidateLegal(candidate, pool, input.blackouts, room);
      if (verdict.legal) { winner = candidate; break; }
      rejections[verdict.reason] += 1;
    }
    if (winner) {
      placed.push({
        sessionId: session.id,
        dayKey: dayKeyFor(days, winner.startsAtMs),
        startsAtMs: winner.startsAtMs,
        endsAtMs: winner.endsAtMs,
        roomId: winner.roomId,
      });
      pool.push({
        id: session.id,
        startsAtMs: winner.startsAtMs,
        endsAtMs: winner.endsAtMs,
        roomId: winner.roomId,
        trackId: session.trackId,
        speakerIds: session.speakerIds as ContactId[],
      });
    } else {
      unplaced.push({ sessionId: session.id, reason: "no_legal_slot", rejections });
    }
  }

  return { placed, unplaced };
}
