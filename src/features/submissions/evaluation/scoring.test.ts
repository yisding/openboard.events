import { describe, expect, it } from "vitest";
import { inReviewerScope, isScorableStatus, weightedOverall } from "./scoring";

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
