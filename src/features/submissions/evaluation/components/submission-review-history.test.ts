import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("submission review history", () => {
  it("is an organizer-only attributed audit view with accessible failure feedback", () => {
    const component = readFileSync(new URL("./submission-review-history.tsx", import.meta.url), "utf8");
    const drawer = readFileSync(new URL("../../components/submission-drawer.tsx", import.meta.url), "utf8");
    const route = readFileSync(
      new URL("../../../../app/api/internal/evaluation/[eventId]/submissions/[submissionId]/reviews/route.ts", import.meta.url),
      "utf8",
    );

    expect(route).toContain('adminAuth({ role: "organizer" })');
    expect(component).toContain("including prior values after an edit");
    expect(component).toContain('role="alert"');
    expect(component).toContain("entry.reviewerName");
    expect(component).toContain("entry.reviewerEmail");
    expect(component).toContain("<TzTime instant={entry.recordedAt} tz={timezone}");
    expect(drawer).toContain("{canEdit && (\n              <SubmissionReviewHistory");
  });
});
