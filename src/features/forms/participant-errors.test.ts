import { describe, expect, it } from "vitest";
import { scopeParticipantFieldErrors, scopedParticipantFieldErrorKey, splitParticipantFieldErrors } from "./participant-errors";

describe("participant field errors", () => {
  it("round-trips errors under the participant client id", () => {
    const scoped = scopeParticipantFieldErrors("panelist:1@example.com", { first_name: "First name is required" });
    expect(scoped).toEqual({
      [scopedParticipantFieldErrorKey("panelist:1@example.com", "first_name")]: "First name is required",
    });
    expect(splitParticipantFieldErrors(scoped)).toEqual({
      unscoped: {},
      byParticipant: { "panelist:1@example.com": { first_name: "First name is required" } },
    });
  });

  it("keeps abstract and primary participant errors unscoped", () => {
    expect(splitParticipantFieldErrors({ title: "Title is required" })).toEqual({
      unscoped: { title: "Title is required" },
      byParticipant: {},
    });
  });

  it("treats prototype-shaped participant ids as ordinary keys", () => {
    const fieldErrors = scopeParticipantFieldErrors("__proto__", { bio: "Biography is required" });
    const split = splitParticipantFieldErrors(fieldErrors);
    expect(Object.keys(split.byParticipant)).toEqual(["__proto__"]);
    expect(split.byParticipant.__proto__).toEqual({ bio: "Biography is required" });
  });
});
