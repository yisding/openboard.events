import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./safe-next";

describe("safeInternalPath", () => {
  it("keeps internal paths with query strings and fragments", () => {
    expect(safeInternalPath("/events/123?tab=tasks#late")).toBe("/events/123?tab=tasks#late");
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
