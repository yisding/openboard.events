import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_COLOR } from "@/shared/lib/brand-color";
import { embedFiltersEqual, embedStylesEqual } from "./embed-config-dirty";

describe("embed config dirty comparisons", () => {
  it("compares styles by value instead of object insertion order", () => {
    const draft = { theme: "dark" as const, accent: "#123456", showHeader: false };
    const saved = { accent: "#123456", theme: "dark" as const, showHeader: false };

    expect(embedStylesEqual(draft, saved)).toBe(true);
  });

  it("treats absent style defaults as their explicit values", () => {
    expect(embedStylesEqual({}, { accent: DEFAULT_BRAND_COLOR, theme: "light", showHeader: true })).toBe(true);
  });

  it("compares filter selections as sets and applies visibility defaults", () => {
    expect(embedFiltersEqual(
      { trackIds: ["track-b", "track-a"], roomIds: [], fields: {} },
      { trackIds: ["track-a", "track-b"], fields: { description: true, speakerCompany: true, speakerBio: true } },
    )).toBe(true);
  });

  it("detects meaningful style, filter, and visibility changes", () => {
    expect(embedStylesEqual({ theme: "light" }, { theme: "dark" })).toBe(false);
    expect(embedFiltersEqual({ roomIds: ["room-a"] }, { roomIds: ["room-b"] })).toBe(false);
    expect(embedFiltersEqual({}, { fields: { speakerBio: false } })).toBe(false);
  });
});
