import { describe, expect, it } from "vitest";
import { signOutDestination } from "./sign-out-button";

describe("sign-out destination", () => {
  it("preserves a safe account-switch handoff and rejects external redirects", () => {
    const invitationLogin = "/login?next=%2Fjoin%3Ftoken%3Dinvite-123";
    expect(signOutDestination("admin", undefined, invitationLogin)).toBe(invitationLogin);
    expect(signOutDestination("admin", undefined, "https://attacker.example/steal")).toBe("/login");
    expect(signOutDestination("portal", "community-ai", undefined)).toBe("/portal/community-ai/login");
  });
});
