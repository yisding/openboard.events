import { describe, expect, it } from "vitest";
import { rowsOf } from "./query-result";

describe("rowsOf", () => {
  const rows = [{ id: "one" }, { id: "two" }];

  it("accepts Neon's direct row array", () => {
    expect(rowsOf<{ id: string }>(rows)).toBe(rows);
  });

  it("accepts the PGlite/pg result envelope", () => {
    expect(rowsOf<{ id: string }>({ rows })).toBe(rows);
  });

  it("returns no rows for unsupported result shapes", () => {
    for (const result of [null, undefined, {}, { rows: null }, { rows: {} }, "rows"]) {
      expect(rowsOf(result)).toEqual([]);
    }
  });
});
