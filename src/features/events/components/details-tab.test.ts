import { describe, expect, it } from "vitest";
import { eventSlugValidationError } from "./details-tab";

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
});
