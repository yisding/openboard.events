import { describe, expect, it } from "vitest";
import { sanitizeEmbedFilters } from "./embed-filter-state";

describe("sanitizeEmbedFilters", () => {
  it("removes legacy stale ids while preserving current filters and field visibility", () => {
    expect(sanitizeEmbedFilters({
      trackIds: ["old-track", "track-1"],
      formatIds: ["old-format"],
      roomIds: ["room-1"],
      fields: { description: false },
    }, {
      trackIds: new Set(["track-1"]),
      formatIds: new Set(),
      roomIds: new Set(["room-1"]),
    })).toEqual({
      trackIds: ["track-1"],
      formatIds: [],
      roomIds: ["room-1"],
      fields: { description: false },
    });
  });
});
