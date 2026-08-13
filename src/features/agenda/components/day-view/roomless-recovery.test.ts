import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agenda Day view room recovery", () => {
  const dayView = readFileSync(new URL("../day-view.tsx", import.meta.url), "utf8");
  const grid = readFileSync(new URL("./day-grid.tsx", import.meta.url), "utf8");
  const tray = readFileSync(new URL("./unscheduled-panel.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../../../app/globals.css", import.meta.url), "utf8");

  it("replaces the unusable zero-room grid with an actionable empty state", () => {
    expect(dayView).toContain("rooms.length === 0");
    expect(dayView).toContain('title="Add a room to build the day grid"');
    expect(dayView).toContain('href={`/events/${eventId}/settings?tab=rooms`}');
    expect(dayView).toContain("Timed sessions stay in Needs a room");
    expect(css).toContain(".dv-no-rooms{");
  });

  it("exposes every timed row without a current room in a draggable, editable panel", () => {
    expect(dayView).toContain("scheduledNeedingRoom(dayScheduled, rooms)");
    expect(dayView).toContain("<NeedsRoomPanel");
    expect(tray).toContain("<h3>Needs a room</h3>");
    expect(tray).toContain('type="session"');
    expect(tray).toContain("onClick={() => onEdit(String(session.id))}");
    expect(tray).toContain("<TzTime instant={session.startsAt}");
    expect(grid).toContain("roomIds.has(String(session.roomId))");
    expect(css).toContain(".dv-tray-edit{border:0;background:transparent");
    expect(css).toContain("min-width:44px;min-height:44px");
  });

  it("does not promise a drag destination until a room exists", () => {
    expect(dayView).toContain("canPlace={rooms.length > 0}");
    expect(tray).toContain('canPlace ? "Drag onto the grid to place." : "Add a room before placing sessions."');
    expect(tray).toContain('canPlace ? "Drag into a room to place." : "Add a room, then place these timed sessions."');
  });
});
