import { describe, expect, it } from "vitest";
import { computeLiveHighlight } from "./live-highlight";

const A = { id: "a", startsAt: "2026-09-16T17:00:00Z", endsAt: "2026-09-16T17:30:00Z" };
const B = { id: "b", startsAt: "2026-09-16T17:30:00Z", endsAt: "2026-09-16T18:00:00Z" };
const C = { id: "c", startsAt: "2026-09-16T18:15:00Z", endsAt: "2026-09-16T18:45:00Z" };

describe("computeLiveHighlight", () => {
  it("marks the session containing now, and the next one to start", () => {
    const result = computeLiveHighlight([A, B, C], new Date("2026-09-16T17:10:00Z"));
    expect(result.nowSessionIds).toEqual(new Set(["a"]));
    expect(result.nextSessionId).toBe("b");
  });

  it("treats the end instant as exclusive — a session cannot be 'now' and 'next' at once", () => {
    const result = computeLiveHighlight([A, B, C], new Date("2026-09-16T17:30:00Z"));
    expect(result.nowSessionIds).toEqual(new Set(["b"]));
    expect(result.nextSessionId).toBe("c");
  });

  it("still finds the next session across a gap between talks", () => {
    const result = computeLiveHighlight([A, B, C], new Date("2026-09-16T18:05:00Z"));
    expect(result.nowSessionIds.size).toBe(0);
    expect(result.nextSessionId).toBe("c");
  });

  it("returns nothing live and nothing next once the day is over", () => {
    const result = computeLiveHighlight([A, B, C], new Date("2026-09-16T19:00:00Z"));
    expect(result.nowSessionIds.size).toBe(0);
    expect(result.nextSessionId).toBeNull();
  });

  it("returns nothing before the day starts, other than the first session being 'next'", () => {
    const result = computeLiveHighlight([A, B, C], new Date("2026-09-16T10:00:00Z"));
    expect(result.nowSessionIds.size).toBe(0);
    expect(result.nextSessionId).toBe("a");
  });

  it("marks two concurrent sessions in different rooms both 'now'", () => {
    const parallel = { id: "d", startsAt: A.startsAt, endsAt: A.endsAt };
    const result = computeLiveHighlight([A, parallel], new Date("2026-09-16T17:10:00Z"));
    expect(result.nowSessionIds).toEqual(new Set(["a", "d"]));
  });
});
