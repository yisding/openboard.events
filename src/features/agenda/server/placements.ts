import { sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/db/client";
import { listSpeakerUnavailabilityIn } from "@/features/portal";
import {
  contactIdSchema,
  sessionIdSchema,
  trackIdSchema,
  type ApplyPlacementInput,
  type ContactId,
  type EventId,
  type PlacedSuggestionDTO,
  type PlacementApplyOutcomeDTO,
  type PlacementApplyResultDTO,
  type PlacementPreviewDTO,
  type UnplacedSuggestionDTO,
  type UserId,
} from "@/shared/contracts";
import { AppError, isAppError } from "@/shared/lib/errors";
import { endOfDayInTz, eventDayKey, shiftDayKey, startOfDayInTz } from "@/shared/lib/time";
import type { ScheduledSession } from "../conflicts";
import { isCandidateLegal, suggestPlacements, type PlannerDayWindow, type PlannerRoom, type PlannerSession } from "../lib/suggest-placements";
import { getSchedulableSessionsIn, listAgendaVocabularyIn } from "./queries";
import { moveSession } from "./mutations";

/**
 * M54 — assisted agenda placement's server composition.
 *
 * Everything here is read-only glue over M28's existing reads and the pure
 * planner, plus `applyPlacementsIn`'s calls into M28's already-audited
 * `moveSession`. Nothing in this file opens a transaction of its own — the
 * module's own guardrail: `moveSession` remains the only scheduling mutation
 * and the only place that does.
 */

// A session with no format has no stored duration. 30 minutes is the same
// PROPOSED-not-literal choice `slots.ts` documents for its own constants —
// close enough to any real talk length that a session lands somewhere
// findable, never so long it starves the day of candidates.
const FALLBACK_DURATION_MINUTES = 30;

async function eventBoundsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<{ timezone: string; startsAtMs: number; endsAtMs: number }> {
  const result = await dbOrTx.execute<{ timezone: string; starts_at: string | Date; ends_at: string | Date }>(sql`
    SELECT timezone, starts_at, ends_at FROM events WHERE id = ${eventId}
  `);
  const row = (result.rows ?? [])[0];
  if (!row) throw new AppError("NOT_FOUND", "Event not found");
  return { timezone: row.timezone, startsAtMs: new Date(row.starts_at).getTime(), endsAtMs: new Date(row.ends_at).getTime() };
}

/**
 * One window per event day, clamped to the event's own start/end so a
 * candidate is never generated before the event opens or after it closes —
 * the work order's "reject outside-event... candidates", enforced
 * structurally by never generating one rather than filtering it out after.
 */
async function dayWindowsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<PlannerDayWindow[]> {
  const { timezone, startsAtMs, endsAtMs } = await eventBoundsIn(dbOrTx, eventId);
  // Mirrors `eventDayKeys` (store.ts): step by *calendar day key*, not by 24
  // hours of absolute milliseconds. Adding 24h moves the local time-of-day by an
  // hour across a spring-forward, so a cursor starting late in the evening rolls
  // past midnight twice and the loop skips a whole calendar day — for an event
  // running 2026-03-07 23:30 to 2026-03-09 12:00 in America/New_York it produced
  // ['2026-03-07','2026-03-09']. The old comment claimed a transition "can
  // neither drop nor duplicate a day", and the `includes` dedupe covered only
  // the duplicate direction.
  const days: string[] = [];
  const lastKey = eventDayKey(endsAtMs, timezone);
  let key = eventDayKey(startsAtMs, timezone);
  for (let guard = 0; guard < 64; guard += 1) {
    days.push(key);
    if (key === lastKey) break;
    key = shiftDayKey(key, 1);
  }
  return days.map((dayKey) => {
    const dayStartMs = startOfDayInTz(dayKey, timezone).getTime();
    // `endOfDayInTz` returns the day's last inclusive millisecond
    // (23:59:59.999 local); the planner wants a half-open upper bound, one
    // millisecond past it.
    const dayEndMsExclusive = endOfDayInTz(dayKey, timezone).getTime() + 1;
    return { dayKey, startMs: Math.max(dayStartMs, startsAtMs), endMsExclusive: Math.min(dayEndMsExclusive, endsAtMs) };
  }).filter((window) => window.startMs < window.endMsExclusive);
}

type PlacementCandidateRow = {
  id: string; title: string; track_id: string | null; row_version: number;
  duration_minutes: number | string; expected_attendance: number | string | null; speaker_ids: string[] | null;
};

type UnscheduledCandidate = PlannerSession & { rowVersion: number };

/**
 * Every currently-unscheduled session, with the fields the planner needs:
 * duration (the session's format's default, or the fallback above), and
 * `expectedAttendance` — the originating submission's `capacity`, `null` for
 * a manual session or one whose submission never declared one. A LEFT JOIN
 * either way, so a session with neither a format nor a submission is still
 * returned, merely unconstrained on both axes.
 */
async function listUnscheduledCandidatesIn(dbOrTx: DbOrTx, eventId: EventId): Promise<UnscheduledCandidate[]> {
  const result = await dbOrTx.execute<PlacementCandidateRow>(sql`
    SELECT
      s.id, s.title, s.track_id, s.row_version,
      coalesce(f.default_duration_mins, ${FALLBACK_DURATION_MINUTES}) AS duration_minutes,
      sub.capacity AS expected_attendance,
      (
        SELECT coalesce(array_agg(ss.contact_id ORDER BY ss.sort_order, ss.contact_id), '{}')
        FROM session_speakers ss WHERE ss.session_id = s.id AND ss.event_id = s.event_id
      ) AS speaker_ids
    FROM sessions s
    LEFT JOIN session_formats f ON f.id = s.format_id AND f.event_id = s.event_id
    LEFT JOIN submissions sub ON sub.id = s.submission_id AND sub.event_id = s.event_id
    WHERE s.event_id = ${eventId} AND s.starts_at IS NULL
    ORDER BY s.id
  `);
  return (result.rows ?? []).map((row) => ({
    id: sessionIdSchema.parse(row.id),
    title: row.title,
    trackId: row.track_id === null ? null : trackIdSchema.parse(row.track_id),
    speakerIds: (row.speaker_ids ?? []).map((id) => contactIdSchema.parse(id)),
    expectedAttendance: row.expected_attendance === null ? null : Number(row.expected_attendance),
    durationMinutes: Number(row.duration_minutes),
    rowVersion: Number(row.row_version),
  }));
}

/**
 * The preview half of M54: read the current schedule, every candidate
 * session's speakers' M51 blackouts, and the room vocabulary, run the pure
 * planner, and shape the result for the wire. Nothing here writes.
 */
export async function previewPlacementsIn(dbOrTx: DbOrTx, eventId: EventId): Promise<PlacementPreviewDTO> {
  const [days, vocabulary, candidates, existing] = await Promise.all([
    dayWindowsIn(dbOrTx, eventId),
    listAgendaVocabularyIn(dbOrTx, eventId),
    listUnscheduledCandidatesIn(dbOrTx, eventId),
    getSchedulableSessionsIn(dbOrTx, eventId),
  ]);
  if (candidates.length === 0) return { placed: [], unplaced: [] };

  const speakerIds = [...new Set(candidates.flatMap((candidate) => candidate.speakerIds))];
  const blackoutRows = await listSpeakerUnavailabilityIn(dbOrTx, eventId, speakerIds);
  const blackouts = blackoutRows.map((row) => ({
    contactId: row.contactId,
    startsAtMs: Date.parse(row.startsAt),
    endsAtMs: Date.parse(row.endsAt),
  }));
  const rooms: PlannerRoom[] = vocabulary.rooms.map((room) => ({ id: room.id, capacity: room.capacity, sortOrder: room.sortOrder }));

  const result = suggestPlacements({ days, rooms, existing, unscheduled: candidates, blackouts });

  const byId = new Map(candidates.map((candidate) => [String(candidate.id), candidate]));
  const roomNameById = new Map(vocabulary.rooms.map((room) => [String(room.id), room.name]));

  const placed: PlacedSuggestionDTO[] = result.placed.map((suggestion) => {
    const candidate = byId.get(String(suggestion.sessionId));
    return {
      sessionId: suggestion.sessionId,
      title: candidate?.title ?? "",
      version: candidate?.rowVersion ?? 1,
      dayKey: suggestion.dayKey,
      startsAt: new Date(suggestion.startsAtMs).toISOString(),
      endsAt: new Date(suggestion.endsAtMs).toISOString(),
      roomId: suggestion.roomId,
      roomName: suggestion.roomId ? roomNameById.get(String(suggestion.roomId)) ?? null : null,
    };
  });
  const unplaced: UnplacedSuggestionDTO[] = result.unplaced.map((suggestion) => ({
    sessionId: suggestion.sessionId,
    title: byId.get(String(suggestion.sessionId))?.title ?? "",
    reason: suggestion.reason,
    rejections: suggestion.rejections,
  }));

  return { placed, unplaced };
}

export const previewPlacements = (eventId: EventId): Promise<PlacementPreviewDTO> => previewPlacementsIn(db, eventId);

function describeSkip(reason: "roomOrSpeakerConflict" | "blackout" | "capacity"): string {
  if (reason === "roomOrSpeakerConflict") return "Another session now occupies that room or speaker at that time";
  if (reason === "blackout") return "A speaker declared unavailable for that time since the preview was generated";
  return "The expected attendance no longer fits that room’s capacity";
}

/**
 * The apply half of M54 (work order §"Algorithm and interface" step, and
 * §"Acceptance criteria"): re-read the schedule and every accepted session's
 * speakers' blackouts fresh — never trust the client's held-open preview —
 * then preflight each accepted row through the exact same `isCandidateLegal`
 * check the planner itself uses, and call `moveSession` only for rows that
 * still pass.
 *
 * Rows are processed **in order**, and a row this batch itself just placed is
 * folded into `pool` before the next row is checked, so two accepted rows
 * that (no longer) fit the same slot can never both land — the second is
 * caught by this same preflight, not merely by `moveSession`'s CAS. A stale
 * `version` and a preflight rejection are reported as distinct outcomes so
 * the UI never confuses "someone changed *this* row" with "someone changed
 * what this row was about to collide with". Every row gets an outcome —
 * "does not discard independent rows from the preview".
 */
export async function applyPlacementsIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  accepted: readonly ApplyPlacementInput[],
  actorUserId: UserId | null = null,
): Promise<PlacementApplyResultDTO> {
  if (accepted.length === 0) return { outcomes: [] };

  const [candidates, vocabulary] = await Promise.all([
    listUnscheduledCandidatesIn(dbOrTx, eventId),
    listAgendaVocabularyIn(dbOrTx, eventId),
  ]);
  const candidatesById = new Map(candidates.map((candidate) => [String(candidate.id), candidate]));
  const roomsById = new Map<string, PlannerRoom>(
    vocabulary.rooms.map((room) => [String(room.id), { id: room.id, capacity: room.capacity, sortOrder: room.sortOrder }]),
  );

  const speakerIds = [...new Set(accepted.flatMap((row) => candidatesById.get(String(row.sessionId))?.speakerIds ?? []))];
  const [blackoutRows, existing] = await Promise.all([
    listSpeakerUnavailabilityIn(dbOrTx, eventId, speakerIds),
    getSchedulableSessionsIn(dbOrTx, eventId),
  ]);
  const blackouts = blackoutRows.map((row) => ({ contactId: row.contactId, startsAtMs: Date.parse(row.startsAt), endsAtMs: Date.parse(row.endsAt) }));

  let pool: ScheduledSession[] = [...existing];
  const outcomes: PlacementApplyOutcomeDTO[] = [];

  for (const row of accepted) {
    const candidate = candidatesById.get(String(row.sessionId));
    if (!candidate) {
      outcomes.push({ outcome: "skipped", sessionId: row.sessionId, message: "This session is no longer unscheduled" });
      continue;
    }
    const room = row.roomId ? roomsById.get(String(row.roomId)) ?? null : null;
    if (row.roomId && !room) {
      outcomes.push({ outcome: "skipped", sessionId: row.sessionId, message: "That room no longer exists" });
      continue;
    }
    const verdict = isCandidateLegal(
      {
        sessionId: row.sessionId,
        startsAtMs: Date.parse(row.startsAt),
        endsAtMs: Date.parse(row.endsAt),
        roomId: row.roomId,
        trackId: candidate.trackId,
        speakerIds: candidate.speakerIds,
        expectedAttendance: candidate.expectedAttendance,
      },
      pool,
      blackouts,
      room,
    );
    if (!verdict.legal) {
      outcomes.push({ outcome: "skipped", sessionId: row.sessionId, message: describeSkip(verdict.reason) });
      continue;
    }
    try {
      // The actor travels with the write so an Auto-place apply is recorded as
      // this organizer's move, exactly like a drag (MTP-07 step 14).
      const moved = await moveSession(
        eventId,
        { id: row.sessionId, version: row.version, startsAt: row.startsAt, endsAt: row.endsAt, roomId: row.roomId },
        actorUserId,
      );
      outcomes.push({ outcome: "applied", sessionId: row.sessionId, session: moved.session, conflicts: moved.conflicts });
      pool = [...pool, {
        id: row.sessionId, startsAtMs: Date.parse(row.startsAt), endsAtMs: Date.parse(row.endsAt),
        roomId: row.roomId, trackId: candidate.trackId, speakerIds: candidate.speakerIds as ContactId[],
      }];
    } catch (error) {
      if (isAppError(error) && error.code === "STALE_WRITE") {
        outcomes.push({ outcome: "stale", sessionId: row.sessionId, message: error.message });
      } else {
        outcomes.push({ outcome: "failed", sessionId: row.sessionId, message: isAppError(error) ? error.message : "Could not apply that placement" });
      }
    }
  }

  return { outcomes };
}

export const applyPlacements = (
  eventId: EventId,
  accepted: readonly ApplyPlacementInput[],
  actorUserId: UserId | null = null,
): Promise<PlacementApplyResultDTO> => applyPlacementsIn(db, eventId, accepted, actorUserId);
