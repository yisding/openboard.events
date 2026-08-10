import type { ConflictDTO, ContactId, RoomId, ScheduledSessionDTO, SessionId, TrackId } from "@/shared/contracts";

/**
 * The one place two sessions are judged to collide.
 *
 * Pure by construction: numbers in, conflicts out. No database, no React, no
 * time zones — a session's instants arrive as epoch milliseconds and the caller
 * owns the conversion, so a scheduling bug can never be a time-zone bug in
 * disguise.
 */
export type ScheduledSession = {
  id: SessionId;
  startsAtMs: number;
  endsAtMs: number;
  roomId: RoomId | null;
  trackId: TrackId | null;
  speakerIds: readonly ContactId[];
};

/** Alias for the frozen contract, so consumers can name it either way. */
export type Conflict = ConflictDTO;

/**
 * A session with no time is unscheduled, not conflicting. Returning `null`
 * rather than a zero-length interval is what keeps the tray's rows structurally
 * out of every grid and every overlap test.
 */
export function toScheduledSession(dto: ScheduledSessionDTO): ScheduledSession | null {
  if (dto.startsAt === null || dto.endsAt === null) return null;
  const startsAtMs = Date.parse(dto.startsAt);
  const endsAtMs = Date.parse(dto.endsAt);
  if (Number.isNaN(startsAtMs) || Number.isNaN(endsAtMs)) return null;
  return {
    id: dto.id,
    startsAtMs,
    endsAtMs,
    roomId: dto.roomId,
    trackId: dto.trackId,
    speakerIds: dto.speakerIds,
  };
}

type Group = { kind: ConflictDTO["kind"]; subjectId: string; sessions: ScheduledSession[] };

function groupsFor(sessions: readonly ScheduledSession[]): Group[] {
  const byRoom = new Map<string, ScheduledSession[]>();
  const byTrack = new Map<string, ScheduledSession[]>();
  const bySpeaker = new Map<string, ScheduledSession[]>();
  const push = (map: Map<string, ScheduledSession[]>, key: string, session: ScheduledSession) => {
    const bucket = map.get(key);
    if (bucket) bucket.push(session);
    else map.set(key, [session]);
  };

  for (const session of sessions) {
    if (session.roomId) push(byRoom, session.roomId, session);
    if (session.trackId) push(byTrack, session.trackId, session);
    // One session joins as many speaker groups as it has speakers; a shared
    // speaker is the collision, not the session.
    for (const speakerId of session.speakerIds) push(bySpeaker, speakerId, session);
  }

  return [
    ...[...byRoom].map(([subjectId, group]) => ({ kind: "room" as const, subjectId, sessions: group })),
    ...[...bySpeaker].map(([subjectId, group]) => ({ kind: "speaker" as const, subjectId, sessions: group })),
    ...[...byTrack].map(([subjectId, group]) => ({ kind: "track" as const, subjectId, sessions: group })),
  ];
}

/**
 * Every overlapping pair, per subject. Sorting each group and sweeping an active
 * set keeps this O(n log n) rather than comparing every session with every other
 * one — a full-conference schedule is small, but the day grid recomputes this on
 * every drag.
 *
 * The overlap test is **strictly** `aStart < bEnd && bStart < aEnd`. Half-open
 * intervals are the whole point: a 10:00–10:30 followed by a 10:30–11:00 is a
 * normal back-to-back pair, and an organizer whose schedule lights up red for it
 * stops believing the feature.
 */
export function detectConflicts(sessions: readonly ScheduledSession[]): ConflictDTO[] {
  const conflicts: ConflictDTO[] = [];

  for (const group of groupsFor(sessions)) {
    if (group.sessions.length < 2) continue;
    const ordered = [...group.sessions].sort((left, right) => left.startsAtMs - right.startsAtMs || left.id.localeCompare(right.id));
    const active: ScheduledSession[] = [];

    for (const candidate of ordered) {
      // Anything that has already ended by the time this one starts can never
      // overlap it, or anything later in the group.
      for (let index = active.length - 1; index >= 0; index -= 1) {
        if ((active[index]?.endsAtMs ?? 0) <= candidate.startsAtMs) active.splice(index, 1);
      }
      for (const open of active) {
        if (!(open.startsAtMs < candidate.endsAtMs && candidate.startsAtMs < open.endsAtMs)) continue;
        conflicts.push({
          kind: group.kind,
          // A double-booked room or a speaker in two places is a blocker; two
          // sessions of one track running at once is a programming choice.
          severity: group.kind === "track" ? "warning" : "error",
          a: open.id,
          b: candidate.id,
          subjectId: group.subjectId,
          overlapStartMs: Math.max(open.startsAtMs, candidate.startsAtMs),
          overlapEndMs: Math.min(open.endsAtMs, candidate.endsAtMs),
        });
      }
      active.push(candidate);
    }
  }

  return conflicts;
}
