import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parsePageQuery } from "./page-query";

const filtersSchema = z.object({
  state: z.enum(["all", "open", "closed"]).default("all"),
  page: z.coerce.number().int().positive().default(1),
  search: z.string().trim().max(20).default(""),
});

describe("parsePageQuery", () => {
  it("parses valid URL values and ignores unknown parameters", () => {
    expect(parsePageQuery(filtersSchema, { state: "open", page: "3", tab: "summary" }))
      .toEqual({ state: "open", page: 3, search: "" });
  });

  it("treats empty values as absent and takes the last repeated value", () => {
    expect(parsePageQuery(filtersSchema, { state: ["closed", "open"], page: "", search: "" }))
      .toEqual({ state: "open", page: 1, search: "" });
  });

  it("drops only invalid fields while retaining valid filters", () => {
    expect(parsePageQuery(filtersSchema, { state: "retired", page: "2", search: "planning" }))
      .toEqual({ state: "all", page: 2, search: "planning" });
  });

  it("falls back to the default view when an object-level refinement cannot be repaired by field", () => {
    const refined = filtersSchema.refine(({ state, search }) => state !== "closed" || search.length > 0);

    expect(parsePageQuery(refined, { state: "closed" }))
      .toEqual({ state: "all", page: 1, search: "" });
  });
});
