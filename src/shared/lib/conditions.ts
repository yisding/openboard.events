import type { Answers, Condition } from "@/shared/contracts";

function hasAnswer(value: unknown) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

export function evaluateCondition(condition: Condition, answers: Answers) {
  const actual = answers[condition.sourceFieldId];
  switch (condition.operator) {
    case "answered": return hasAnswer(actual);
    case "empty": return !hasAnswer(actual);
    case "eq": return Array.isArray(actual) ? actual.includes(String(condition.value ?? "")) : actual === condition.value;
    case "neq": return Array.isArray(actual) ? !actual.includes(String(condition.value ?? "")) : actual !== condition.value;
    case "in": return Array.isArray(actual) ? actual.includes(String(condition.value ?? "")) : Array.isArray(condition.value) ? condition.value.includes(String(actual ?? "")) : actual === condition.value;
    case "not_in": return Array.isArray(actual) ? !actual.includes(String(condition.value ?? "")) : Array.isArray(condition.value) ? !condition.value.includes(String(actual ?? "")) : actual !== condition.value;
  }
}

export function evaluateRule(rule: { match: "all" | "any"; conditions: Condition[] }, answers: Answers) {
  if (rule.conditions.length === 0) return true;
  return rule.match === "all" ? rule.conditions.every((condition) => evaluateCondition(condition, answers)) : rule.conditions.some((condition) => evaluateCondition(condition, answers));
}
