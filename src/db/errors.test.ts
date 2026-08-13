import { describe, expect, it } from "vitest";
import { isConstraintViolation } from "./errors";

describe("isConstraintViolation", () => {
  it("recognizes structured constraint names through wrapped driver errors", () => {
    const error = {
      message: "Drizzle query failed",
      cause: { message: "Postgres error", cause: { constraint: "events_slug_key" } },
    };

    expect(isConstraintViolation(error, "events_slug_key")).toBe(true);
  });

  it("recognizes constraint names included in driver messages", () => {
    expect(isConstraintViolation(
      { message: "duplicate key value violates unique constraint organizations_slug_key" },
      "organizations_slug_key",
    )).toBe(true);
  });

  it("rejects unrelated and excessively deep causes", () => {
    expect(isConstraintViolation({ constraint: "other_constraint" }, "events_slug_key")).toBe(false);
    expect(isConstraintViolation({
      cause: { cause: { cause: { cause: { cause: { constraint: "events_slug_key" } } } } },
    }, "events_slug_key")).toBe(false);
  });
});
