import { describe, expect, it } from "vitest";
import { invitationTokenFromNextPath, signupDestination } from "./signup-context";

describe("signup invitation context", () => {
  it("extracts a bearer token only from the supported internal join path", () => {
    expect(invitationTokenFromNextPath("/join?token=invite-123")).toBe("invite-123");
    expect(invitationTokenFromNextPath("/organizations?token=invite-123")).toBeNull();
    expect(invitationTokenFromNextPath("https://attacker.example/join?token=invite-123")).toBeNull();
    expect(invitationTokenFromNextPath("/join")).toBeNull();
  });

  it("lands a token-provisioned signup in that organization and preserves ordinary next paths", () => {
    expect(signupDestination("/join?token=invite-123", "00000000-0000-4000-8000-000000000001"))
      .toBe("/organizations/00000000-0000-4000-8000-000000000001");
    expect(signupDestination("/organizations", null)).toBe("/organizations");
    expect(signupDestination("/organizations", "not-an-organization-id")).toBe("/organizations");
  });
});
