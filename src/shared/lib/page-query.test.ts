import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MAX_PAGE_NUMBER, pageNumberFrom, parsePageQuery } from "./page-query";

const filtersSchema = z.object({
  state: z.enum(["all", "open", "closed"]).default("all"),
  page: z.coerce.number().int().positive().default(1),
  search: z.string().trim().max(20).default(""),
});

describe("pageNumberFrom", () => {
  it("reads a plain page number and defaults an absent one to the first page", () => {
    expect(pageNumberFrom("3")).toBe(3);
    expect(pageNumberFrom(undefined)).toBe(1);
    expect(pageNumberFrom("1")).toBe(1);
  });

  it("degrades a fractional page to the first page instead of a fractional SQL offset", () => {
    // `Number.isFinite(1.5)` is true and `1.5 > 0` is true, so the previous
    // guard passed it straight through to `(page - 1) * pageSize`. Postgres
    // rejects a fractional OFFSET outright — `invalid input syntax for type
    // bigint` — so `?page=1.5` took the whole directory down with a 500.
    expect(pageNumberFrom("1.5")).toBe(1);
    expect(pageNumberFrom("2.000001")).toBe(1);
  });

  it("degrades a page whose offset would leave the safe integer range", () => {
    // Every caller multiplies by a page size, so a page that is itself a safe
    // integer can still produce an offset that is not, failing `.int()` one
    // multiplication after the guard that was supposed to have cleared it.
    expect(pageNumberFrom("1e30")).toBe(1);
    expect(pageNumberFrom(String(Number.MAX_SAFE_INTEGER))).toBe(1);
    expect(pageNumberFrom(String(MAX_PAGE_NUMBER))).toBe(MAX_PAGE_NUMBER);
    expect(pageNumberFrom(String(MAX_PAGE_NUMBER + 1))).toBe(1);
  });

  it("degrades a non-numeric, negative or zero page to the first page", () => {
    expect(pageNumberFrom("banana")).toBe(1);
    expect(pageNumberFrom("-4")).toBe(1);
    expect(pageNumberFrom("0")).toBe(1);
    expect(pageNumberFrom("")).toBe(1);
  });
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
