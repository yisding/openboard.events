import { describe, expect, it } from "vitest";
import {
  conditionSchema,
  answerValueSchema,
  fieldIdSchema,
  routingRuleSchema,
  trackIdSchema,
  type AnswerValue,
  type Answers,
} from "@/shared/contracts";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import { applyRouting, evaluateCondition, evaluateRule, evaluateVisibility, stripHiddenAnswers } from "./conditions";

const SOURCE = fieldIdSchema.parse("00000000-0000-4000-8000-000000000103");
const TOPICS = fieldIdSchema.parse("00000000-0000-4000-8000-000000000104");
const TRACK = trackIdSchema.parse("00000000-0000-4000-8000-000000000200");

function answer(value: AnswerValue): Answers {
  return { [SOURCE]: value };
}

describe("condition evaluator", () => {
  it.each([
    ["eq", { t: "s", v: "agents" }, "agents", true],
    ["eq", { t: "s", v: "safety" }, "agents", false],
    ["neq", { t: "s", v: "safety" }, "agents", true],
    ["neq", { t: "s", v: "agents" }, "agents", false],
    ["eq", { t: "opt", v: "agents" }, "agents", true],
    ["in", { t: "opts", v: ["agents", "evals"] }, "agents", true],
    ["in", { t: "opts", v: ["agents", "evals"] }, ["safety", "evals"], true],
    ["in", { t: "opts", v: ["agents"] }, ["safety", "evals"], false],
    ["not_in", { t: "opts", v: ["agents", "evals"] }, "safety", true],
    ["not_in", { t: "opts", v: ["agents", "evals"] }, "agents", false],
    ["answered", { t: "s", v: "hello" }, undefined, true],
    ["answered", { t: "s", v: "" }, undefined, false],
    ["answered", { t: "opts", v: [] }, undefined, false],
    ["answered", { t: "n", v: 0 }, undefined, true],
    ["empty", { t: "opts", v: [] }, undefined, true],
    ["empty", { t: "s", v: "hello" }, undefined, false],
  ] as const)("evaluates %s for %o", (op, actual, expected, result) => {
    const condition = conditionSchema.parse({ sourceFieldId: SOURCE, op, ...(expected === undefined ? {} : { value: expected }) });
    expect(evaluateCondition(condition, answer(answerValueSchema.parse(actual)))).toBe(result);
  });

  it.each(["eq", "neq", "in", "not_in"] as const)("rejects %s without a value", (op) => {
    expect(conditionSchema.safeParse({ sourceFieldId: SOURCE, op }).success).toBe(false);
  });

  it.each(["answered", "empty"] as const)("rejects %s with a value", (op) => {
    expect(conditionSchema.safeParse({ sourceFieldId: SOURCE, op, value: "x" }).success).toBe(false);
  });

  it("supports all and any groups", () => {
    const answered = conditionSchema.parse({ sourceFieldId: SOURCE, op: "answered" });
    const agents = conditionSchema.parse({ sourceFieldId: SOURCE, op: "eq", value: "agents" });
    expect(evaluateRule({ match: "all", conditions: [answered, agents] }, answer({ t: "opt", v: "agents" }))).toBe(true);
    expect(evaluateRule({ match: "any", conditions: [answered, agents] }, {})).toBe(false);
  });

  it("computes visibility and strips hidden answers", () => {
    const hidden = evaluateVisibility(GOLDEN_SNAPSHOT, {});
    expect(hidden.has(TOPICS)).toBe(false);
    const visibleAnswers = answer({ t: "opt", v: "agents" });
    const visible = evaluateVisibility(GOLDEN_SNAPSHOT, visibleAnswers);
    expect(visible.has(TOPICS)).toBe(true);
    expect(stripHiddenAnswers(GOLDEN_SNAPSHOT, { ...visibleAnswers, [TOPICS]: { t: "opts", v: ["evals"] } })).toHaveProperty(TOPICS);
    expect(stripHiddenAnswers(GOLDEN_SNAPSHOT, { [TOPICS]: { t: "opts", v: ["evals"] } })).not.toHaveProperty(TOPICS);
  });

  it("applies only the first enabled matching routing rule", () => {
    const first = routingRuleSchema.parse({ id: "00000000-0000-4000-8000-000000000301", sortOrder: 1, match: "all", conditions: [{ sourceFieldId: SOURCE, op: "eq", value: "agents" }], setTrackId: TRACK, addTagIds: [], enabled: true });
    const fallback = routingRuleSchema.parse({ id: "00000000-0000-4000-8000-000000000302", sortOrder: 2, match: "all", conditions: [{ sourceFieldId: SOURCE, op: "answered" }], addTagIds: [], enabled: true });
    expect(applyRouting([fallback, first], answer({ t: "opt", v: "agents" }))).toEqual({ setTrackId: TRACK, addTagIds: [] });
  });
});
