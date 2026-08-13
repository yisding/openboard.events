import { describe, expect, it, vi } from "vitest";
import {
  canAttemptReviewerInvite,
  focusReviewerEmail,
  normalizeReviewerEmail,
  reviewerEmailValidationError,
} from "./reviewer-invite-dialog";

describe("reviewer invite email recovery", () => {
  it("lets a nonempty invalid address reach visible validation", () => {
    expect(canAttemptReviewerInvite("not-an-email", false)).toBe(true);
    expect(reviewerEmailValidationError("not-an-email")).toBe("Enter a valid email address");
    expect(normalizeReviewerEmail("not-an-email")).toBeNull();
    expect(canAttemptReviewerInvite("", false)).toBe(false);
    expect(canAttemptReviewerInvite("reviewer@example.com", true)).toBe(false);
  });

  it("does not ask an organizer to create or share reviewer credentials", async () => {
    const source = await import("node:fs").then(({ readFileSync }) => readFileSync(new URL("./reviewer-invite-dialog.tsx", import.meta.url), "utf8"));
    expect(source).not.toContain("Initial password");
    expect(source).not.toContain("new-password");
    expect(source).toContain("email-bound link");
    expect(source).toContain('body: JSON.stringify({ email: validEmail })');
    expect(source).toContain("Pending invitations");
    expect(source).toContain("/reviewers/invitations/${invitation.id}");
    expect(source).toContain('<TzTime instant={invitation.expiresAt} tz={timezone} style="date" />');
    const route = await import("node:fs").then(({ readFileSync }) => readFileSync(new URL("../../../../app/api/internal/evaluation/[eventId]/reviewers/route.ts", import.meta.url), "utf8"));
    expect(route).toContain("rateLimit: {");
    expect(route).toContain("reviewer-invite:${eventId");
  });

  it("returns focus to the invalid email control", () => {
    const focus = vi.fn();
    const schedule = vi.fn((callback: () => void) => callback());
    focusReviewerEmail({ current: { focus } }, schedule);
    expect(schedule).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });
});
