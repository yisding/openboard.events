import { describe, expect, it } from "vitest";
import { enabledSecondaryParticipantRoles } from "./participant-roles";

describe("enabledSecondaryParticipantRoles", () => {
  it("returns only enabled additional roles in canonical order", () => {
    expect(enabledSecondaryParticipantRoles([
      { role: "panelist", enabled: true },
      { role: "speaker", enabled: true },
      { role: "co_speaker", enabled: false },
      { role: "moderator", enabled: true },
    ])).toEqual(["moderator", "panelist"]);
  });

  it("rejects unknown participant roles", () => {
    expect(() => enabledSecondaryParticipantRoles([{ role: "guest", enabled: true }])).toThrow();
  });
});
