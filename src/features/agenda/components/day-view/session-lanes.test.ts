import { describe, expect, it } from "vitest";
import { layoutSessionLanes, type SessionLaneInterval } from "./session-lanes";

const interval = (id: string, startMinutes: number, endMinutes: number, roomId = "main"): SessionLaneInterval => ({
  id,
  roomId,
  startMinutes,
  endMinutes,
});

describe("layoutSessionLanes", () => {
  it("splits true overlaps and lets adjacent sessions use the full room width", () => {
    const lanes = layoutSessionLanes([
      interval("first", 9 * 60, 10 * 60),
      interval("overlap", 9 * 60 + 30, 10 * 60 + 30),
      interval("adjacent", 10 * 60 + 30, 11 * 60),
    ]);

    expect(lanes.get("first")).toEqual({ index: 0, count: 2 });
    expect(lanes.get("overlap")).toEqual({ index: 1, count: 2 });
    expect(lanes.get("adjacent")).toEqual({ index: 0, count: 1 });
  });

  it("keeps one stable width across a connected overlap group and reuses free lanes", () => {
    const lanes = layoutSessionLanes([
      interval("long", 9 * 60, 11 * 60),
      interval("early", 9 * 60 + 15, 10 * 60),
      interval("late", 10 * 60, 10 * 60 + 45),
    ]);

    expect(lanes.get("long")).toEqual({ index: 0, count: 2 });
    expect(lanes.get("early")).toEqual({ index: 1, count: 2 });
    expect(lanes.get("late")).toEqual({ index: 1, count: 2 });
  });

  it("never narrows sessions that happen at the same time in different rooms", () => {
    const lanes = layoutSessionLanes([
      interval("main", 9 * 60, 10 * 60, "main"),
      interval("studio", 9 * 60, 10 * 60, "studio"),
    ]);

    expect(lanes.get("main")).toEqual({ index: 0, count: 1 });
    expect(lanes.get("studio")).toEqual({ index: 0, count: 1 });
  });
});
