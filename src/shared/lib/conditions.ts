import type { Answers, Condition } from "@/shared/contracts";

function hasAnswer(value: unknown) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

export function evaluateCondition(condition: Condition, answers: Answers) {
  const actual = answers[condition.sourceFieldId];
  const expected = condition.value;
  switch (condition.operator) {
    case "answered": return hasAnswer(actual);
    case "empty": return !hasAnswer(actual);
    case "eq": return Array.isArray(actual) ? actual.includes(String(expected ?? "")) : actual === expected;
    case "neq": return Array.isArray(actual) ? !actual.includes(String(expected ?? "")) : actual !== expected;
    case "in": return Array.isArray(actual) ? actual.includes(String(expected ?? "")) : Array.isArray(expected) ? expected.includes(String(actual ?? "")) : actual === expected;
    case "not_in": return Array.isArray(actual) ? !actual.includes(String(expected ?? "")) : Array.isArray(expected) ? !expected.includes(String(actual ?? "")) : actual !== expected;
  }
}

export function evaluateRule(rule: { match: "all" | "any"; conditions: Condition[] }, answers: Answers) {
  if (rule.conditions.length === 0) return true;
  return rule.match === "all" ? rule.conditions.every((condition) => evaluateCondition(condition, answers)) : rule.conditions.some((condition) => evaluateCondition(condition, answers));
}
