import { describe, expect, it } from "vitest";
import { authPathWithNext, safeInternalPath } from "./safe-next";

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

describe("authPathWithNext", () => {
  it("carries an internal invitation destination between auth choices", () => {
    expect(authPathWithNext("/login", "/join?token=invite-123"))
      .toBe("/login?next=%2Fjoin%3Ftoken%3Dinvite-123");
  });

  it("drops external and protocol-relative destinations", () => {
    expect(authPathWithNext("/signup", "https://attacker.example/steal")).toBe("/signup");
    expect(authPathWithNext("/signup", "//attacker.example/steal")).toBe("/signup");
  });
});
