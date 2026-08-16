import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { roomIdSchema, type RoomDTO } from "@/shared/contracts";
import { roomCapacityWarning } from "./room-capacity";

const studio = roomIdSchema.parse("c1000000-0000-4000-8000-000000000001");
const mainStage = roomIdSchema.parse("c1000000-0000-4000-8000-000000000002");
const unmeasured = roomIdSchema.parse("c1000000-0000-4000-8000-000000000003");

const rooms: RoomDTO[] = [
  { id: studio, name: "Studio", capacity: 60, sortOrder: 0 },
  { id: mainStage, name: "Main Stage", capacity: 1200, sortOrder: 1 },
  { id: unmeasured, name: "Atrium", capacity: null, sortOrder: 2 },
];

describe("roomCapacityWarning", () => {
  it("names the room, its seats and the expected audience when the room is too small", () => {
    expect(roomCapacityWarning({ expectedAttendance: 200, roomId: studio }, rooms))
      .toBe("Studio seats 60, and this session’s abstract expects 200.");
  });

  it("says nothing when the room fits, including exactly", () => {
    expect(roomCapacityWarning({ expectedAttendance: 200, roomId: mainStage }, rooms)).toBeNull();
    expect(roomCapacityWarning({ expectedAttendance: 60, roomId: studio }, rooms)).toBeNull();
  });

  it("stays silent where the product has no honest number to compare", () => {
    // A manually created session: nothing in the product estimates its audience.
    expect(roomCapacityWarning({ expectedAttendance: null, roomId: studio }, rooms)).toBeNull();
    // A room whose capacity was never filled in constrains nothing.
    expect(roomCapacityWarning({ expectedAttendance: 5_000, roomId: unmeasured }, rooms)).toBeNull();
    // Unscheduled, or dropped in the "needs a room" lane.
    expect(roomCapacityWarning({ expectedAttendance: 5_000, roomId: null }, rooms)).toBeNull();
    // A room deleted while the grid was open.
    expect(roomCapacityWarning({ expectedAttendance: 5_000, roomId: "c1000000-0000-4000-8000-0000000000ff" }, rooms)).toBeNull();
  });

  // The dialog's half is asserted by rendering it, in
  // `../components/session-capacity-advisory.test.tsx`: that the advisory
  // appears against the draft's room, that it clears when a bigger room is
  // picked, and — the property that matters — that Save stays clickable with
  // the warning on screen. Reading the button's `disabled=` expression out of
  // the source could never establish the last of those.
  it("is wired into the drop path too, not just Auto-place and the dialog", () => {
    const move = readFileSync(new URL("../hooks/use-move-session.ts", import.meta.url), "utf8");
    const dayView = readFileSync(new URL("../components/day-view.tsx", import.meta.url), "utf8");

    // The drop path warns on the same toast that offers Undo.
    expect(move).toContain("const capacityWarning = roomCapacityWarning(result.session, rooms);");
    expect(dayView).toContain("useMoveSession(eventId, rooms)");
  });
});
