import type { SessionRecord } from "@/shared/demo/types";
import { overlaps } from "@/shared/lib/intervals";

export type SessionConflict = { kind: "room" | "speaker" | "track"; severity: "error" | "warning"; sessionA: string; sessionB: string; message: string };

export function detectConflicts(sessions: SessionRecord[]): SessionConflict[] {
  const scheduled = sessions.filter((session): session is SessionRecord & { startsAt: string; endsAt: string } => Boolean(session.startsAt && session.endsAt));
  const conflicts: SessionConflict[] = [];
  for (let left = 0; left < scheduled.length; left += 1) {
    for (let right = left + 1; right < scheduled.length; right += 1) {
      const a = scheduled[left]; const b = scheduled[right];
      if (!a || !b || !overlaps({ start: a.startsAt, end: a.endsAt }, { start: b.startsAt, end: b.endsAt })) continue;
      if (a.room && a.room === b.room) conflicts.push({ kind: "room", severity: "error", sessionA: a.id, sessionB: b.id, message: `${a.room} is double-booked` });
      if (a.speakerIds.some((id) => b.speakerIds.includes(id))) conflicts.push({ kind: "speaker", severity: "error", sessionA: a.id, sessionB: b.id, message: "A speaker is scheduled in two places" });
      if (a.track && a.track === b.track && a.room !== b.room) conflicts.push({ kind: "track", severity: "warning", sessionA: a.id, sessionB: b.id, message: `${a.track} sessions overlap` });
    }
  }
  return conflicts;
}
