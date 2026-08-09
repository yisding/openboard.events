import type {
  AnswerValue,
  Answers,
  CleanAnswers,
  Condition,
  FieldId,
  FormSnapshot,
  RoutingRule,
} from "@/shared/contracts";

/**
 * eq/neq compare a scalar or option id; a multiselect is equal only when it is
 * exactly the singleton selection. `in` is the multiselect "contains" form.
 * Full semantics are specified by src/shared/lib/conditions.test.ts.
 */
export function isAnswered(value: AnswerValue | undefined): boolean {
  if (!value) return false;
  if (value.t === "s") return value.v.trim().length > 0;
  if (value.t === "opts") return value.v.length > 0;
  return value.v !== "";
}

function expectedScalar(value: Condition["value"]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function equals(condition: Condition, answer: AnswerValue | undefined): boolean {
  if (!isAnswered(answer)) return false;
  const expected = expectedScalar(condition.value);
  if (expected === undefined || !answer) return false;
  if (answer.t === "opts") return answer.v.length === 1 && answer.v[0] === expected;
  return String(answer.v) === expected;
}

function isIn(condition: Condition, answer: AnswerValue | undefined): boolean {
  if (!isAnswered(answer) || !answer) return false;
  const expected = Array.isArray(condition.value) ? condition.value : condition.value === undefined ? [] : [condition.value];
  return answer.t === "opts"
    ? answer.v.some((optionId) => expected.includes(optionId))
    : expected.includes(String(answer.v));
}

export function evaluateCondition(condition: Condition, answers: Answers): boolean {
  const answer = answers[condition.sourceFieldId];
  switch (condition.op) {
    case "answered":
      return isAnswered(answer);
    case "empty":
      return !isAnswered(answer);
    case "eq":
      return equals(condition, answer);
    case "neq":
      return !equals(condition, answer);
    case "in":
      return isIn(condition, answer);
    case "not_in":
      return !isIn(condition, answer);
  }
}

export function evaluateRule(rule: Pick<RoutingRule, "match" | "conditions">, answers: Answers): boolean {
  return rule.match === "all"
    ? rule.conditions.every((condition) => evaluateCondition(condition, answers))
    : rule.conditions.some((condition) => evaluateCondition(condition, answers));
}

export function evaluateVisibility(snapshot: FormSnapshot, answers: Answers): Set<FieldId> {
  const visible = new Set<FieldId>();
  const effective: Partial<Record<FieldId, AnswerValue>> = {};
  for (const section of snapshot.sections) {
    for (const field of section.fields) {
      if (!field.visibility || evaluateRule(field.visibility, effective)) {
        visible.add(field.id);
        const answer = answers[field.id];
        if (answer !== undefined) effective[field.id] = answer;
      }
    }
  }
  return visible;
}

export function stripHiddenAnswers(
  snapshot: FormSnapshot,
  answers: Answers,
  visible: ReadonlySet<string> = evaluateVisibility(snapshot, answers),
): { clean: Answers; discarded: string[] } {
  const known = new Set(snapshot.sections.flatMap((section) => section.fields.map((field) => field.id)));
  const clean: Partial<Record<FieldId, AnswerValue>> = {};
  const discarded: string[] = [];
  for (const [fieldId, answer] of Object.entries(answers)) {
    if (known.has(fieldId as FieldId) && visible.has(fieldId)) clean[fieldId as FieldId] = answer;
    else discarded.push(fieldId);
  }
  return { clean, discarded };
}

export function cleanAnswersToRecord(clean: CleanAnswers, participantId: string | null = null): Answers {
  return Object.fromEntries(
    clean.filter((answer) => answer.participantId === participantId).map((answer) => [answer.fieldId, answer.value]),
  );
}

export function applyRouting(rules: readonly RoutingRule[], answers: Answers): {
  trackId: RoutingRule["setTrackId"] | null;
  tagIds: RoutingRule["addTagIds"];
  matchedRuleId: string | null;
} {
  const matched = rules.find((rule) => rule.enabled && evaluateRule(rule, answers));
  return matched
    ? { trackId: matched.setTrackId ?? null, tagIds: [...matched.addTagIds], matchedRuleId: matched.id }
    : { trackId: null, tagIds: [], matchedRuleId: null };
}
