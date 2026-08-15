import { describe, expect, it } from "vitest";
import { dueRangeFilters, parseDeliverableFiltersForPage } from "./filters";

describe("parseDeliverableFiltersForPage", () => {
  it("parses the Files view's valid URL filters", () => {
    expect(parseDeliverableFiltersForPage({
      state: "overdue",
      hasUpload: "false",
      dueOnOrAfter: "2026-08-01",
      search: " slides ",
    })).toMatchObject({
      state: "overdue",
      hasUpload: "false",
      dueOnOrAfter: "2026-08-01",
      search: "slides",
    });
  });

  it("keeps valid filters when stale values fall back to defaults", () => {
    expect(parseDeliverableFiltersForPage({
      state: "archived",
      dueOnOrBefore: "next-week",
      search: "headshots",
    })).toEqual({ state: "all", search: "headshots" });
  });
});

describe("dueRangeFilters", () => {
  const la = "America/Los_Angeles";

  it("resolves date-only filters against the event's zone, not the runtime's", () => {
    // A naive `new Date("2026-09-15")` is midnight UTC — 5pm the previous day
    // in Los Angeles, so a deliverable due that afternoon would fall outside
    // its own range.
    expect(dueRangeFilters({ dueOnOrAfter: "2026-09-15" }, la)).toEqual({
      dueAfter: "2026-09-15T07:00:00.000Z",
    });
    expect(dueRangeFilters({ dueOnOrBefore: "2026-09-15" }, la)).toEqual({
      dueBefore: "2026-09-16T06:59:59.999Z",
    });
  });

  it("returns nothing for an unfiltered range", () => {
    expect(dueRangeFilters({}, la)).toEqual({});
  });
});
