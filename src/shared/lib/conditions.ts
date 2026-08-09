import type {
  AnswerValue,
  Answers,
  CleanAnswers,
  Condition,
  FieldId,
  FormSnapshot,
  RoutingRule,
} from "@/shared/contracts";

function scalar(value: AnswerValue | undefined): string | number | string[] | undefined {
  if (!value) return undefined;
  return value.v;
}

function hasAnswer(value: AnswerValue | undefined): boolean {
  const actual = scalar(value);
  return actual !== undefined && actual !== "" && (!Array.isArray(actual) || actual.length > 0);
}

export function evaluateCondition(condition: Condition, answers: Answers): boolean {
  const answer = answers[condition.sourceFieldId];
  const actual = scalar(answer);
  switch (condition.op) {
    case "answered":
      return hasAnswer(answer);
    case "empty":
      return !hasAnswer(answer);
    case "eq":
      return Array.isArray(actual) ? actual.includes(String(condition.value)) : actual === condition.value;
    case "neq":
      return Array.isArray(actual) ? !actual.includes(String(condition.value)) : actual !== condition.value;
    case "in": {
      const expected = Array.isArray(condition.value) ? condition.value : [condition.value];
      return Array.isArray(actual)
        ? actual.some((item) => expected.includes(item))
        : expected.includes(String(actual ?? ""));
    }
    case "not_in": {
      const expected = Array.isArray(condition.value) ? condition.value : [condition.value];
      return Array.isArray(actual)
        ? actual.every((item) => !expected.includes(item))
        : !expected.includes(String(actual ?? ""));
    }
  }
}

export function evaluateRule(rule: Pick<RoutingRule, "match" | "conditions">, answers: Answers): boolean {
  return rule.match === "all"
    ? rule.conditions.every((condition) => evaluateCondition(condition, answers))
    : rule.conditions.some((condition) => evaluateCondition(condition, answers));
}

export function evaluateVisibility(snapshot: FormSnapshot, answers: Answers): Set<FieldId> {
  const visible = new Set<FieldId>();
  for (const section of snapshot.sections) {
    for (const field of section.fields) {
      if (!field.visibility || evaluateRule(field.visibility, answers)) visible.add(field.id);
    }
  }
  return visible;
}

export function stripHiddenAnswers(snapshot: FormSnapshot, answers: Answers): Answers {
  const visible = evaluateVisibility(snapshot, answers);
  return Object.fromEntries(Object.entries(answers).filter(([fieldId]) => visible.has(fieldId as FieldId)));
}

export function cleanAnswersToRecord(clean: CleanAnswers, participantId: string | null = null): Answers {
  return Object.fromEntries(
    clean.filter((answer) => answer.participantId === participantId).map((answer) => [answer.fieldId, answer.value]),
  );
}

export function applyRouting(rules: readonly RoutingRule[], answers: Answers): { setTrackId: RoutingRule["setTrackId"] | null; addTagIds: RoutingRule["addTagIds"] } {
  const matched = [...rules].filter((rule) => rule.enabled).sort((a, b) => a.sortOrder - b.sortOrder).find((rule) => evaluateRule(rule, answers));
  return matched ? { setTrackId: matched.setTrackId ?? null, addTagIds: matched.addTagIds } : { setTrackId: null, addTagIds: [] };
}
