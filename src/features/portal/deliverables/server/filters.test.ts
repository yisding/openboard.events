import { describe, expect, it } from "vitest";
import { parseDeliverableFiltersForPage } from "./filters";

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
