import { describe, expect, it } from "vitest";
import { isCompactSession } from "./session-card";

describe("isCompactSession", () => {
  it("uses the concise time-and-title layout through the 45-minute boundary", () => {
    expect(isCompactSession(15)).toBe(true);
    expect(isCompactSession(44)).toBe(true);
    expect(isCompactSession(45)).toBe(true);
    expect(isCompactSession(46)).toBe(false);
    expect(isCompactSession(60)).toBe(false);
  });
});
