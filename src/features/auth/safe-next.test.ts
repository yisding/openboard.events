import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./safe-next";

describe("safeInternalPath", () => {
  it("keeps internal paths with query strings and fragments", () => {
    expect(safeInternalPath("/events/123?tab=tasks#late")).toBe("/events/123?tab=tasks#late");
  });

  it("keeps an encoded internal path inside the query", () => {
    expect(safeInternalPath("/portal/x/login?next=%2Fportal%2Fx%2Fprofile")).toBe("/portal/x/login?next=%2Fportal%2Fx%2Fprofile");
  });

  it.each([
    "https://evil.example/path",
    "//evil.example/path",
    "/\\evil.example/path",
    "\\evil.example/path",
    "/%5cevil.example/path",
    "/%2f%2fevil.example/path",
  ])("rejects unsafe redirect target %s", (value) => {
    expect(safeInternalPath(value)).toBe("/events");
  });
});
