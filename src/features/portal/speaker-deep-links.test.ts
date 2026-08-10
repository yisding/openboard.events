import { describe, expect, it } from "vitest";
import type { SpeakerRecord } from "@/shared/demo/types";
import { matchesMissingAsset, parseSpeakerMissing } from "./speaker-deep-links";

function speaker(overrides: Partial<SpeakerRecord> = {}): SpeakerRecord {
  return {
    id: "speaker-1",
    eventId: "event-1",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    company: "Analytical Engines",
    title: "Programmer",
    bio: "Writes programs.",
    location: "London",
    website: "",
    linkedin: "",
    avatar: "AL",
    avatarColor: "#007454",
    hasHeadshot: true,
    confirmation: "confirmed",
    profileCompletion: 100,
    tags: [],
    ...overrides,
  };
}

describe("speaker deep links", () => {
  it("accepts only the frozen missing-asset values", () => {
    expect(parseSpeakerMissing("either")).toBe("either");
    expect(parseSpeakerMissing("everything")).toBeNull();
  });

  it("filters bio, headshot, and either independently", () => {
    const missingBio = speaker({ bio: "" });
    const missingHeadshot = speaker({ hasHeadshot: false });
    expect(matchesMissingAsset(missingBio, "bio")).toBe(true);
    expect(matchesMissingAsset(missingBio, "headshot")).toBe(false);
    expect(matchesMissingAsset(missingHeadshot, "headshot")).toBe(true);
    expect(matchesMissingAsset(missingHeadshot, "either")).toBe(true);
    expect(matchesMissingAsset(speaker(), "either")).toBe(false);
  });
});
