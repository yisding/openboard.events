import { describe, expect, it } from "vitest";
import { criterionIdSchema } from "@/shared/contracts";
import {
  inReviewerScope,
  isReviewComplete,
  isScorableStatus,
  isValidCriterionValue,
  normalizeCriterionValues,
  reviewWindow,
  scorableValue,
  weightedMean,
  weightedOverall,
} from "./scoring";

const track = "11111111-1111-4111-8111-111111111111";
const otherTrack = "22222222-2222-4222-8222-222222222222";

describe("weightedOverall", () => {
  it("averages equal weights", () => {
    expect(weightedOverall([{ id: "a", weight: 1 }, { id: "b", weight: 1 }], { a: 4, b: 5 })).toBe(4.5);
  });

  it("respects unequal weights", () => {
    // 3×3 + 5×1 over 4 = 3.5, not the unweighted 4.
    expect(weightedOverall([{ id: "a", weight: 3 }, { id: "b", weight: 1 }], { a: 3, b: 5 })).toBe(3.5);
  });

  it("rounds to two decimals", () => {
    expect(weightedOverall([{ id: "a", weight: 1 }, { id: "b", weight: 1 }, { id: "c", weight: 1 }], { a: 4, b: 4, c: 5 })).toBe(4.33);
  });

  it("leaves a review with a blank criterion unscored rather than counting it as zero", () => {
    expect(weightedOverall([{ id: "a", weight: 1 }, { id: "b", weight: 1 }], { a: 4 })).toBeNull();
  });

  it("has no opinion when the round has no criteria", () => {
    // The reviewer sets the overall score directly in that case.
    expect(weightedOverall([], { a: 4 })).toBeNull();
  });
});

describe("inReviewerScope", () => {
  const base = { status: "pending", submissionTrackId: track, planTrackIds: null, assignmentTrackIds: null } as const;

  it("admits everything when neither scope names a track", () => {
    expect(inReviewerScope(base)).toBe(true);
    expect(inReviewerScope({ ...base, submissionTrackId: null })).toBe(true);
  });

  it("needs both scopes to admit the track", () => {
    expect(inReviewerScope({ ...base, planTrackIds: [track], assignmentTrackIds: [track] })).toBe(true);
    expect(inReviewerScope({ ...base, planTrackIds: [track], assignmentTrackIds: [otherTrack] })).toBe(false);
    expect(inReviewerScope({ ...base, planTrackIds: [otherTrack], assignmentTrackIds: null })).toBe(false);
  });

  it("hides an uncategorized submission from any track-scoped reviewer", () => {
    // A track filter cannot match a submission that has no track, so the only
    // way to see one is for both scopes to be open.
    expect(inReviewerScope({ ...base, submissionTrackId: null, assignmentTrackIds: [track] })).toBe(false);
  });

  it("never routes a draft or a withdrawal", () => {
    expect(inReviewerScope({ ...base, status: "draft" })).toBe(false);
    expect(inReviewerScope({ ...base, status: "withdrawn" })).toBe(false);
    expect(isScorableStatus("accepted")).toBe(true);
  });
});

describe("typed criterion values (M50)", () => {
  const numeric = {
    id: criterionIdSchema.parse("c9000000-0000-4000-8000-000000000001"),
    kind: "numeric" as const, weight: 3, required: true, options: [], minValue: null, maxValue: null,
  };
  const choice = {
    id: criterionIdSchema.parse("c9000000-0000-4000-8000-000000000002"),
    kind: "select" as const, weight: 1, required: true, minValue: null, maxValue: null,
    options: [
      { id: "accept", label: "Accept", score: 5 },
      { id: "abstain", label: "Abstain", score: null },
    ],
  };
  const note = {
    id: criterionIdSchema.parse("c9000000-0000-4000-8000-000000000003"),
    kind: "text" as const, weight: 1, required: false, options: [], minValue: null, maxValue: null,
  };
  const scale = { min: 1, max: 5 };

  it("lifts M19's bare numbers into discriminated values and drops what it cannot read", () => {
    expect(normalizeCriterionValues({ [numeric.id]: 4 })).toEqual({ [numeric.id]: { kind: "numeric", value: 4 } });
    // A payload nobody can interpret must not become a score.
    expect(normalizeCriterionValues({ [numeric.id]: { kind: "mystery" }, other: null, another: "4" })).toEqual({});
    expect(normalizeCriterionValues(null)).toEqual({});
  });

  it("averages only what is scorable, over only the weights that contributed", () => {
    // (4×3 + 5×1) / 4
    expect(weightedMean([numeric, choice, note], {
      [numeric.id]: { kind: "numeric", value: 4 },
      [choice.id]: { kind: "select", optionId: "accept" },
      [note.id]: { kind: "text", value: "Would attend" },
    })).toBe(4.25);

    // An unscored option and a written note are answers that never move the mean,
    // so the number stands alone rather than being dragged toward zero.
    expect(weightedMean([numeric, choice, note], {
      [numeric.id]: { kind: "numeric", value: 2 },
      [choice.id]: { kind: "select", optionId: "abstain" },
      [note.id]: { kind: "text", value: "No view" },
    })).toBe(2);

    // Nothing scorable at all is null, never 0.
    expect(weightedMean([choice, note], { [choice.id]: { kind: "select", optionId: "abstain" } })).toBeNull();
  });

  it("counts a review as complete only once every required criterion is answered", () => {
    expect(isReviewComplete([numeric, choice, note], { [numeric.id]: { kind: "numeric", value: 4 } }, null, scale)).toBe(false);
    expect(isReviewComplete([numeric, choice, note], {
      [numeric.id]: { kind: "numeric", value: 4 },
      [choice.id]: { kind: "select", optionId: "accept" },
    }, 4, scale)).toBe(true);
    // A round with no criteria falls back to M19's single overall score.
    expect(isReviewComplete([], {}, null, scale)).toBe(false);
    expect(isReviewComplete([], {}, 3, scale)).toBe(true);
  });

  it("refuses a value of the wrong kind, an unknown option, and a number outside its bounds", () => {
    expect(isValidCriterionValue(numeric, { kind: "text", value: "four" }, scale)).toBe(false);
    expect(isValidCriterionValue(numeric, { kind: "numeric", value: 9 }, scale)).toBe(false);
    expect(isValidCriterionValue({ ...numeric, minValue: 2, maxValue: 4 }, { kind: "numeric", value: 5 }, scale)).toBe(false);
    expect(isValidCriterionValue(choice, { kind: "select", optionId: "nope" }, scale)).toBe(false);
    expect(isValidCriterionValue(note, { kind: "text", value: "   " }, scale)).toBe(false);
    expect(isValidCriterionValue(note, { kind: "text", value: "Solid" }, scale)).toBe(true);
  });

  it("treats an unscored option as present but worth nothing", () => {
    expect(scorableValue(choice, { kind: "select", optionId: "abstain" })).toBeNull();
    expect(scorableValue(choice, { kind: "select", optionId: "accept" })).toBe(5);
    expect(scorableValue(note, { kind: "text", value: "Long note" })).toBeNull();
  });
});

describe("review window (M50)", () => {
  const open = { status: "open" as const, opensAt: "2026-09-01T17:00:00.000Z", closesAt: "2026-09-10T17:00:00.000Z" };

  it("is half-open: the opening instant is inside it and the closing instant is not", () => {
    expect(reviewWindow(open, new Date("2026-09-01T16:59:59.999Z"))).toMatchObject({ state: "before_open", canRead: false, canSave: false });
    expect(reviewWindow(open, new Date("2026-09-01T17:00:00.000Z"))).toMatchObject({ state: "open", canRead: true, canSave: true });
    expect(reviewWindow(open, new Date("2026-09-10T16:59:59.999Z"))).toMatchObject({ state: "open", canSave: true });
    expect(reviewWindow(open, new Date("2026-09-10T17:00:00.000Z"))).toMatchObject({ state: "closed", canRead: true, canSave: false });
  });

  it("leaves prior work readable after close, and an unbounded round always open", () => {
    expect(reviewWindow(open, new Date("2027-01-01T00:00:00.000Z")).canRead).toBe(true);
    expect(reviewWindow({ status: "open", opensAt: null, closesAt: null }, new Date()))
      .toMatchObject({ state: "open", canRead: true, canSave: true });
  });

  it("stops saves on a round an organizer closed by hand, whatever the dates say", () => {
    expect(reviewWindow({ ...open, status: "closed" }, new Date("2026-09-05T00:00:00.000Z")))
      .toMatchObject({ state: "open", canRead: true, canSave: false });
  });
});
