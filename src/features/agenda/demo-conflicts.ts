import type { ContactId, RoomId, SessionId, TrackId } from "@/shared/contracts";
import type { SessionRecord } from "@/shared/demo/types";
import { detectConflicts, type ScheduledSession } from "./conflicts";

/**
 * The browser demo's adapter onto the real conflict engine.
 *
 * `detectConflicts` now speaks the frozen `ConflictDTO` — ids and epoch
 * milliseconds — because that is what the server, the day grid and the Conflicts
 * tab all consume. The demo store predates it and keeps rooms and tracks as
 * display names, so this file translates in and out rather than letting a second
 * overlap implementation exist for the demo's benefit.
 */
export type DemoConflict = {
  kind: "room" | "speaker" | "track";
  severity: "error" | "warning";
  sessionA: string;
  sessionB: string;
  message: string;
};

/**
 * Names stand in for ids here. The engine only ever compares subject keys for
 * equality and hands the winner back as `subjectId`, so a display name works as
 * the key and comes back out ready to print.
 */
function toDemoScheduled(session: SessionRecord): ScheduledSession | null {
  if (!session.startsAt || !session.endsAt) return null;
  return {
    id: session.id as SessionId,
    startsAtMs: Date.parse(session.startsAt),
    endsAtMs: Date.parse(session.endsAt),
    roomId: (session.room || null) as RoomId | null,
    trackId: (session.track || null) as TrackId | null,
    speakerIds: session.speakerIds as ContactId[],
  };
}

function message(kind: DemoConflict["kind"], subjectId: string): string {
  if (kind === "room") return `${subjectId} is double-booked`;
  if (kind === "speaker") return "A speaker is scheduled in two places";
  return `${subjectId} sessions overlap`;
}

export function demoConflicts(sessions: readonly SessionRecord[]): DemoConflict[] {
  const scheduled = sessions.map(toDemoScheduled).filter((session): session is ScheduledSession => session !== null);
  return detectConflicts(scheduled).map((conflict) => ({
    kind: conflict.kind,
    severity: conflict.severity,
    sessionA: conflict.a,
    sessionB: conflict.b,
    message: message(conflict.kind, conflict.subjectId),
  }));
}
