import { describe, expect, it } from "vitest";
import { BULK_DECISION_LIMIT } from "../bulk-decision-limit";
import { abstractAllMatchingHref, abstractSelectionScope } from "./abstract-matching-selection";

describe("abstract all-matching selection", () => {
  it("offers the complete bounded match set only after the whole page is selected", () => {
    expect(abstractSelectionScope({ selectedCount: 24, pageRowCount: 25, filteredTotal: 87 })).toEqual({
      countLabel: "24 abstracts selected on this page",
      allMatching: false,
      selectAllMatchingCount: null,
    });
    expect(abstractSelectionScope({ selectedCount: 25, pageRowCount: 25, filteredTotal: 87 })).toEqual({
      countLabel: "25 abstracts selected on this page",
      allMatching: false,
      selectAllMatchingCount: 87,
    });
  });

  it("describes a freshly rendered complete set as matching, not merely page-local", () => {
    expect(abstractSelectionScope({ selectedCount: 87, pageRowCount: 87, filteredTotal: 87 })).toEqual({
      countLabel: "87 matching abstracts selected",
      allMatching: true,
      selectAllMatchingCount: null,
    });
    expect(abstractSelectionScope({ selectedCount: 1, pageRowCount: 1, filteredTotal: 1 }).countLabel)
      .toBe("1 matching abstract selected");
  });

  it("stays page-local above the transition cap, including if matches grow during navigation", () => {
    expect(abstractSelectionScope({
      selectedCount: BULK_DECISION_LIMIT,
      pageRowCount: BULK_DECISION_LIMIT,
      filteredTotal: BULK_DECISION_LIMIT + 1,
    })).toEqual({
      countLabel: `${BULK_DECISION_LIMIT} abstracts selected on this page`,
      allMatching: false,
      selectAllMatchingCount: null,
    });
  });

  it("requests one authoritative 200-row page while preserving every active filter and sort", () => {
    const href = abstractAllMatchingHref(new URLSearchParams({
      status: "pending",
      search: "edge agents",
      trackId: "track-1",
      tagId: "tag-1",
      sort: "rating",
      page: "3",
      pageSize: "25",
    }), 87);
    const query = new URLSearchParams(href?.slice(1));

    expect(query.get("status")).toBe("pending");
    expect(query.get("search")).toBe("edge agents");
    expect(query.get("trackId")).toBe("track-1");
    expect(query.get("tagId")).toBe("tag-1");
    expect(query.get("sort")).toBe("rating");
    expect(query.get("page")).toBeNull();
    expect(query.get("pageSize")).toBe(String(BULK_DECISION_LIMIT));
    expect(query.get("arm")).toBe("1");
  });

  it("refuses empty, fractional, and over-cap requests", () => {
    const current = new URLSearchParams("status=pending&page=2");
    expect(abstractAllMatchingHref(current, 0)).toBeNull();
    expect(abstractAllMatchingHref(current, 4.5)).toBeNull();
    expect(abstractAllMatchingHref(current, BULK_DECISION_LIMIT + 1)).toBeNull();
  });
});
