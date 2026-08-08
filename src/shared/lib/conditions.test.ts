import { describe, expect, it } from "vitest";
import { conditionSchema } from "@/shared/contracts";
import { evaluateCondition, evaluateRule } from "./conditions";

describe("condition evaluator", () => {
  it.each([
    ["eq", "AI Agents", "AI Agents", true],
    ["eq", "Safety", "AI Agents", false],
    ["neq", "Safety", "AI Agents", true],
    ["answered", "hello", undefined, true],
    ["answered", "", undefined, false],
    ["empty", [] as string[], undefined, true],
    ["in", ["agents", "evals"] as string[], "agents", true],
    ["not_in", ["agents", "evals"] as string[], "safety", true],
  ] as const)("evaluates %s", (operator, actual, expected, result) => {
    const condition = conditionSchema.parse({ sourceFieldId: "source", operator, ...(expected === undefined ? {} : { value: expected }) });
    expect(evaluateCondition(condition, { source: actual })).toBe(result);
  });

  it.each(["eq", "neq", "in", "not_in"] as const)("rejects %s without a value", (operator) => {
    expect(conditionSchema.safeParse({ sourceFieldId: "source", operator }).success).toBe(false);
  });

  it.each(["answered", "empty"] as const)("accepts %s without a value", (operator) => {
    expect(conditionSchema.safeParse({ sourceFieldId: "source", operator }).success).toBe(true);
  });

  it("supports all and any groups", () => {
    const conditions = [
      { sourceFieldId: "track", operator: "eq" as const, value: "AI Agents" },
      { sourceFieldId: "demo", operator: "answered" as const },
    ];
    expect(evaluateRule({ match: "all", conditions }, { track: "AI Agents", demo: "Yes" })).toBe(true);
    expect(evaluateRule({ match: "any", conditions }, { track: "Safety", demo: "" })).toBe(false);
  });
});
