import { describe, expect, it } from "vitest";
import { overlaps } from "./intervals";

describe("overlaps", () => {
  it("allows back-to-back sessions", () => {
    expect(overlaps({ start: "2026-09-15T09:00:00Z", end: "2026-09-15T09:30:00Z" }, { start: "2026-09-15T09:30:00Z", end: "2026-09-15T10:00:00Z" })).toBe(false);
  });
  it("detects intersecting sessions", () => {
    expect(overlaps({ start: "2026-09-15T09:00:00Z", end: "2026-09-15T09:45:00Z" }, { start: "2026-09-15T09:30:00Z", end: "2026-09-15T10:00:00Z" })).toBe(true);
  });
});
