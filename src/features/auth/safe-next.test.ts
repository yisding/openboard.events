import { describe, expect, it } from "vitest";
import {
  authenticatedAuthDestination,
  authPathWithNext,
  googleSignupPath,
  requestsGoogleSignup,
  safeInternalPath,
} from "./safe-next";

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
    "/.//evil.example/path",
  ])("rejects unsafe redirect target %s", (value) => {
    expect(safeInternalPath(value)).toBe("/events");
  });

  it("rejects repeated redirect parameters instead of choosing one", () => {
    expect(safeInternalPath(["/events", "/join?token=invite-123"])).toBe("/events");
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

describe("googleSignupPath", () => {
  it("opens the Google signup step and keeps the pending destination", () => {
    expect(googleSignupPath("/join?token=invite-123"))
      .toBe("/signup?next=%2Fjoin%3Ftoken%3Dinvite-123&provider=google");
    expect(googleSignupPath(null)).toBe("/signup?provider=google");
  });

  it("drops a destination it would not redirect to anyway", () => {
    expect(googleSignupPath("https://attacker.example/steal")).toBe("/signup?provider=google");
  });

  it("recognises only its own handoff", () => {
    expect(requestsGoogleSignup(new URLSearchParams(googleSignupPath("/organizations").split("?")[1]))).toBe(true);
    expect(requestsGoogleSignup(new URLSearchParams("next=%2Forganizations"))).toBe(false);
    expect(requestsGoogleSignup(new URLSearchParams("provider=github"))).toBe(false);
  });
});

describe("authenticatedAuthDestination", () => {
  it("continues an authenticated invitee to the pending invitation", () => {
    expect(authenticatedAuthDestination("/join?token=invite-123"))
      .toBe("/join?token=invite-123");
  });

  it.each([
    [undefined, "/organizations"],
    ["https://attacker.example/steal", "/organizations"],
    ["/.//attacker.example/steal", "/organizations"],
    ["/login?next=%2Fsignup", "/organizations"],
    ["/signup/check-email?email=owner%40example.com", "/organizations"],
    [["/events", "/join?token=invite-123"], "/organizations"],
  ])("falls back instead of redirecting an existing session to %s", (value, expected) => {
    expect(authenticatedAuthDestination(value)).toBe(expected);
  });
});
