import { describe, expect, it, vi } from "vitest";
import {
  eventDetailsValidationErrors,
  eventSlugValidationError,
  focusDetailsError,
  focusDetailsNotice,
  STALE_NOTICE_A11Y,
} from "./details-tab";

describe("event details slug validation", () => {
  it("rejects invalid and reserved slugs before save", () => {
    expect(eventSlugValidationError(" ")).toBe("Event slug is required");
    expect(eventSlugValidationError("My Event")).toBe("Slug must be lowercase letters, numbers and single hyphens");
    expect(eventSlugValidationError("two--hyphens")).toBe("Slug must be lowercase letters, numbers and single hyphens");
    expect(eventSlugValidationError("portal")).toBe("“portal” is a reserved word and cannot be used as a slug");
  });

  it("accepts a trimmed lowercase slug", () => {
    expect(eventSlugValidationError("  my-event-2026  ")).toBeNull();
  });

  it("associates each invalid value with the first field that must recover focus", () => {
    expect(eventDetailsValidationErrors({ name: "", slug: "My Event", startsAt: null, endsAt: null, theme: "" })).toEqual({
      name: "Event name is required",
      slug: "Slug must be lowercase letters, numbers and single hyphens",
      startsAt: "Start date and time are required",
      endsAt: "End date and time are required",
    });

    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    focusDetailsError({ querySelector }, { current: null }, (callback) => callback());
    expect(querySelector).toHaveBeenCalledWith('[aria-invalid="true"]');
    expect(focus).toHaveBeenCalledOnce();
  });

  it("focuses the alert summary when a response error has no invalid field", () => {
    const focus = vi.fn();
    focusDetailsError(null, { current: { focus } }, (callback) => callback());
    expect(focus).toHaveBeenCalledOnce();
  });

  it("announces and focuses a stale-write recovery notice", () => {
    expect(STALE_NOTICE_A11Y).toEqual({ role: "alert", tabIndex: -1 });
    const focus = vi.fn();
    const schedule = vi.fn((callback: () => void) => callback());
    focusDetailsNotice({ current: { focus } }, schedule);
    expect(schedule).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });
});
