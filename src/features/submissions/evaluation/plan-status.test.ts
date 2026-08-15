import { describe, expect, it } from "vitest";
import { planStatusBadge } from "./plan-status";

describe("plan status badge", () => {
  const open = { status: "open" as const, opensAt: "2026-09-01T17:00:00.000Z", closesAt: "2026-09-10T17:00:00.000Z" };

  it("says what a reviewer would find, not only what the organizer intended", () => {
    expect(planStatusBadge(open, new Date("2026-08-14T00:00:00.000Z"))).toBe("scheduled");
    expect(planStatusBadge(open, new Date("2026-09-05T00:00:00.000Z"))).toBe("open");
    expect(planStatusBadge(open, new Date("2026-09-11T00:00:00.000Z"))).toBe("ended");
  });

  it("keeps a hand-closed round closed whatever its dates say", () => {
    expect(planStatusBadge({ ...open, status: "closed" }, new Date("2026-09-05T00:00:00.000Z"))).toBe("closed");
  });

  it("leaves an unbounded round simply open", () => {
    expect(planStatusBadge({ status: "open", opensAt: null, closesAt: null })).toBe("open");
  });
});
