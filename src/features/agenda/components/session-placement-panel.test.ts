import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describePlacement } from "./session-form-dialog";

const tz = "America/Los_Angeles";

describe("describePlacement", () => {
  it("reads as a room and a wall-clock time in the event's own zone", () => {
    const line = describePlacement(
      { startsAt: "2026-09-16T17:00:00.000Z", endsAt: "2026-09-16T18:00:00.000Z", roomName: "Studio" },
      tz,
    );
    expect(line).toContain("Studio");
    // 17:00Z is 10am in Los Angeles — the organizer's history must not be
    // narrated in UTC any more than the grid is.
    expect(line).toContain("10:00");
  });

  it("says where a session sat even when it had no room", () => {
    expect(describePlacement({ startsAt: "2026-09-16T17:00:00.000Z", endsAt: null, roomName: null }, tz))
      .toContain("No room");
  });

  it("calls the unscheduled tray by its name instead of leaving a blank side", () => {
    expect(describePlacement({ startsAt: null, endsAt: null, roomName: null }, tz)).toBe("Unscheduled");
  });
});

describe("the session history panel", () => {
  const source = readFileSync(new URL("./session-form-dialog.tsx", import.meta.url), "utf8");

  it("shows the placement half beside the content half, from one request", () => {
    expect(source).toContain('<Field label="Placement history"');
    expect(source).toContain("const placements = query.data?.placements ?? [];");
    // One query key, one spinner, one failure mode: a panel that can be
    // half-loaded is a panel that can quietly lie about a session's history.
    expect((source.match(/agenda\/sessions\/\$\{sessionId\}\/revisions\?eventId=/gu) ?? []).length).toBe(1);
    expect(source).toContain("describePlacement(move.from, timezone)");
    expect(source).toContain("describePlacement(move.to, timezone)");
    expect(source).toContain('{move.movedByName ?? "Someone"}');
  });

  it("keeps an empty placement history distinct from a session that was never edited", () => {
    expect(source).toContain("No moves recorded yet");
    expect(source).toContain("No edits recorded yet.");
  });
});
