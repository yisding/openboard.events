import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND_COLOR } from "@/shared/lib/brand-color";
import { embedFiltersEqual, embedStylesEqual, hasUnsavedEmbedSettings } from "./embed-config-dirty";
import type { EmbedConfigDTO } from "./embed-config-types";

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

  it("keeps a sanitized draft dirty while stale vocabulary ids remain persisted", () => {
    expect(embedFiltersEqual({ trackIds: [] }, { trackIds: ["deleted-track"] })).toBe(false);
  });

  it("aggregates clean, dirty, and reverted drafts across every embed card", () => {
    const configs = [
      { contentType: "agenda", style: { theme: "light" }, filters: {} },
      { contentType: "speaker_gallery", style: {}, filters: { fields: { speakerBio: true } } },
    ] satisfies Array<Pick<EmbedConfigDTO, "contentType" | "style" | "filters">>;
    const cleanStyles = { agenda: { theme: "light" as const }, speaker_gallery: {} };
    const cleanFilters = { agenda: {}, speaker_gallery: {} };

    expect(hasUnsavedEmbedSettings(configs, cleanStyles, cleanFilters)).toBe(false);
    expect(hasUnsavedEmbedSettings(configs, {
      ...cleanStyles,
      speaker_gallery: { accent: "#123456" },
    }, cleanFilters)).toBe(true);
    expect(hasUnsavedEmbedSettings(configs, cleanStyles, {
      ...cleanFilters,
      agenda: { roomIds: ["room-a"] },
    })).toBe(true);
    expect(hasUnsavedEmbedSettings(configs, cleanStyles, cleanFilters)).toBe(false);
  });
});
