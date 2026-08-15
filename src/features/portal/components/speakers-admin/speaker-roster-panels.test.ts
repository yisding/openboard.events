import { describe, expect, it } from "vitest";
import {
  isUnavailabilityDraftDirty,
  mergeIncomingLogisticsValues,
  validateUnavailabilityDraft,
  type UnavailabilityDraftRow,
} from "./speaker-roster-panels";

const savedInterval: UnavailabilityDraftRow = {
  startsAt: "2026-09-01T16:00:00.000Z",
  endsAt: "2026-09-01T17:00:00.000Z",
  reason: "Flight",
};
const saved: UnavailabilityDraftRow[] = [savedInterval];

describe("speaker roster draft recovery", () => {
  it("keeps half-filled windows invalid instead of dropping them", () => {
    const result = validateUnavailabilityDraft([{ startsAt: savedInterval.startsAt, endsAt: null }]);
    expect(result.intervals).toBeNull();
    expect(result.errors).toEqual([{ endsAt: "Choose an end time" }]);
  });

  it("rejects reversed windows and overlong reasons before the replace call", () => {
    const result = validateUnavailabilityDraft([{
      startsAt: savedInterval.endsAt,
      endsAt: savedInterval.startsAt,
      reason: "x".repeat(201),
    }]);
    expect(result.intervals).toBeNull();
    expect(result.errors).toEqual([{
      endsAt: "End must be after start",
      reason: "Reason must be 200 characters or fewer",
    }]);
  });

  it("normalizes valid windows and permits an intentional clear-all", () => {
    expect(validateUnavailabilityDraft([])).toEqual({ errors: [], intervals: [] });
    expect(validateUnavailabilityDraft([{ ...savedInterval, reason: "  Flight  " }]).intervals).toEqual(saved);
  });

  it("detects meaningful availability changes without warning on reason whitespace", () => {
    expect(isUnavailabilityDraftDirty(saved, saved)).toBe(false);
    expect(isUnavailabilityDraftDirty([{ ...savedInterval, reason: " Flight " }], saved)).toBe(false);
    expect(isUnavailabilityDraftDirty([{ ...savedInterval, endsAt: "2026-09-01T18:00:00.000Z" }], saved)).toBe(true);
  });

  it("merges server logistics refreshes without overwriting locally edited fields", () => {
    expect(mergeIncomingLogisticsValues(
      { hotel: "Local draft", shirt: "M" },
      { hotel: "Old hotel", shirt: "M" },
      { hotel: "New server hotel", shirt: "L", dietary: "Vegan" },
    )).toEqual({ hotel: "Local draft", shirt: "L", dietary: "Vegan" });
  });
});
