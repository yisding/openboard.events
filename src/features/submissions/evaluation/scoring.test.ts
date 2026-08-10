import { describe, expect, it } from "vitest";
import { inReviewerScope, isScorableStatus } from "./scoring";

const track = "11111111-1111-4111-8111-111111111111";
const otherTrack = "22222222-2222-4222-8222-222222222222";

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
