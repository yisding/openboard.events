import { describe, expect, it } from "vitest";
import { SUBMISSION_STATUSES } from "@/shared/contracts";
import { PORTAL_STATUSES, portalStatus } from "./server/queries";

/**
 * The type alone cannot carry this: `PORTAL_STATUS_LABEL` is annotated as
 * `Record<SubmissionStatus, string>`, so anything derived from it widens to
 * `string`. This is where a contract change that introduces a new speaker-facing
 * label — or worse, leaks a queue state — fails.
 */
describe("portal status", () => {
  it("maps every submission status into the speaker-facing union", () => {
    for (const status of SUBMISSION_STATUSES) {
      expect(PORTAL_STATUSES).toContain(portalStatus(status));
    }
  });

  it("collapses both queue states to Pending", () => {
    expect(portalStatus("accept_queue")).toBe("Pending");
    expect(portalStatus("decline_queue")).toBe("Pending");
    expect(portalStatus("pending")).toBe("Pending");
  });

  it("keeps the decided states distinguishable", () => {
    expect(portalStatus("accepted")).toBe("Accepted");
    expect(portalStatus("declined")).toBe("Declined");
    expect(portalStatus("withdrawn")).toBe("Withdrawn");
    expect(portalStatus("draft")).toBe("Draft");
  });
});
