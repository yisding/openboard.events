import { describe, expect, it, vi } from "vitest";
import {
  canAttemptReviewerInvite,
  focusReviewerEmail,
  normalizeReviewerEmail,
  reviewerEmailValidationError,
} from "./reviewer-invite-dialog";

describe("reviewer invite email recovery", () => {
  it("lets a nonempty invalid address reach visible validation", () => {
    expect(canAttemptReviewerInvite("not-an-email", "123456789012", false)).toBe(true);
    expect(reviewerEmailValidationError("not-an-email")).toBe("Enter a valid email address");
    expect(normalizeReviewerEmail("not-an-email")).toBeNull();
    expect(canAttemptReviewerInvite("", "123456789012", false)).toBe(false);
  });

  it("returns focus to the invalid email control", () => {
    const focus = vi.fn();
    const schedule = vi.fn((callback: () => void) => callback());
    focusReviewerEmail({ current: { focus } }, schedule);
    expect(schedule).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });
});
