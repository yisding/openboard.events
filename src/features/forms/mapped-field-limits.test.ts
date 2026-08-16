import { describe, expect, it } from "vitest";
import { fieldMaxChars, LIMITS } from "@/shared/contracts";

/**
 * `LIMITS.JOB_TITLE`'s own comment states the invariant this protects: "a value
 * one writer accepts must never be one another rejects, or the profile form
 * (which sends both fields on every save) would be stuck."
 */
describe("fieldMaxChars for mapped contact fields", () => {
  const text = { type: "text" as const, maxChars: 255 };

  it("clamps a mapped company or job title to the ceiling every writer shares", () => {
    // The stock CFP authors both at 255, and only `submission.title` was
    // clamped. A speaker who pasted a 180-character affiliation into the
    // Company question — advertised to them as 255 — could never save their
    // portal profile again: the prefilled value fails on every PATCH, and the
    // input's own `maxLength` stops them retyping it but not the value already
    // there.
    expect(fieldMaxChars({ ...text, mapsTo: "contact.company" })).toBe(LIMITS.JOB_TITLE);
    expect(fieldMaxChars({ ...text, mapsTo: "contact.job_title" })).toBe(LIMITS.JOB_TITLE);
  });

  it("still clamps a mapped title, and leaves an unmapped field alone", () => {
    expect(fieldMaxChars({ ...text, mapsTo: "submission.title" })).toBe(LIMITS.TITLE);
    expect(fieldMaxChars({ ...text, mapsTo: null })).toBe(255);
  });

  it("never raises an authored limit that is already stricter", () => {
    expect(fieldMaxChars({ type: "text", maxChars: 40, mapsTo: "contact.company" })).toBe(40);
  });
});
