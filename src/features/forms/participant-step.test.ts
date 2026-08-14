import { describe, expect, it } from "vitest";
import { normalizeParticipantStepRoles, participantStepInputSchema } from "./participant-step";

const valid = {
  operationId: "a0000000-0000-4000-8000-000000000001",
  expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
  sectionId: "a1000000-0000-4000-8000-000000000001",
  participantRoles: [
    { role: "speaker", enabled: true },
    { role: "co_speaker", enabled: false },
    { role: "moderator", enabled: false },
    { role: "panelist", enabled: false },
  ],
  section: { title: "Speakers", pageHeading: "About you", descriptionHtml: "" },
};

describe("participant step request contract", () => {
  it("accepts only the bounded participant operation and a boolean replay marker", () => {
    expect(participantStepInputSchema.safeParse({ ...valid, participantReplay: true }).success).toBe(true);
    expect(participantStepInputSchema.safeParse({ ...valid, participantReplay: "yes" }).success).toBe(false);
    expect(participantStepInputSchema.safeParse({ ...valid, patch: { status: "open" } }).success).toBe(false);
  });

  it("rejects missing and duplicate participant roles", () => {
    expect(participantStepInputSchema.safeParse({
      ...valid,
      participantRoles: valid.participantRoles.slice(0, 3),
    }).success).toBe(false);
    expect(participantStepInputSchema.safeParse({
      ...valid,
      participantRoles: valid.participantRoles.map((role) => ({ ...role, role: "speaker" })),
    }).success).toBe(false);
  });

  it("canonicalizes a supported persisted subset while rejecting duplicates and unknown roles", () => {
    expect(normalizeParticipantStepRoles([{ role: "speaker", enabled: false }])).toEqual([
      { role: "speaker", enabled: true },
      { role: "co_speaker", enabled: false },
      { role: "moderator", enabled: false },
      { role: "panelist", enabled: false },
    ]);
    expect(() => normalizeParticipantStepRoles([
      { role: "speaker", enabled: true },
      { role: "speaker", enabled: false },
    ])).toThrow();
    expect(() => normalizeParticipantStepRoles([{ role: "host" as "speaker", enabled: true }])).toThrow();
  });
});
