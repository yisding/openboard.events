import type { RoomDTO } from "@/shared/contracts";

/**
 * MTP-07 §2 step 12 — "is this room big enough?", asked once, in one place.
 *
 * The planner (`suggest-placements.ts`) has always weighed a room's `capacity`
 * against a session's `expectedAttendance` — the number the originating
 * abstract declared — but it answers by *silently excluding* the room, which
 * only Auto-place could see. A manual placement is an explicit human decision,
 * so the same comparison produces a sentence instead of an exclusion: the
 * organizer who really does want the 200-person session in the 60-seat studio
 * keeps that power, and merely stops doing it by accident.
 *
 * Two silences are deliberate and are the reason this returns `null` rather
 * than an "unknown" verdict:
 *
 * - A room with no declared capacity constrains nothing. Guessing a number for
 *   it would invent a warning out of an empty settings field.
 * - A session with no expected attendance — every manually created one, and any
 *   promoted abstract whose form never asked — has nothing to compare. Nothing
 *   in the product stores an audience estimate for those, and inventing one
 *   from the format or the track would be a fiction the organizer cannot check.
 */
export function roomCapacityWarning(
  session: { expectedAttendance?: number | null; roomId?: string | null },
  rooms: readonly RoomDTO[],
): string | null {
  const expected = session.expectedAttendance;
  if (typeof expected !== "number" || expected <= 0) return null;
  const roomId = session.roomId;
  if (!roomId) return null;
  const room = rooms.find((candidate) => String(candidate.id) === String(roomId));
  if (!room || room.capacity === null || room.capacity >= expected) return null;
  return `${room.name} seats ${room.capacity}, and this session’s abstract expects ${expected}.`;
}
