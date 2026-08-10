import type { Condition, RoutingRule, TagDTO, TrackDTO, VisibilityRule } from "@/shared/contracts";
import type { BuilderField } from "../../builder-types";

type SummaryField = Pick<BuilderField, "id" | "label" | "options">;

function fieldLabel(fields: readonly SummaryField[], fieldId: string): string {
  return fields.find((field) => field.id === fieldId)?.label ?? "a deleted question";
}

function describeValue(fields: readonly SummaryField[], condition: Condition): string {
  const field = fields.find((candidate) => candidate.id === condition.sourceFieldId);
  const values = Array.isArray(condition.value) ? condition.value : condition.value !== undefined ? [condition.value] : [];
  if (values.length === 0) return "";
  const labels = values.map((value) => field?.options.find((option) => option.id === value)?.label ?? value);
  return labels.join(", ");
}

function conditionPhrase(condition: Condition, fields: readonly SummaryField[]): string {
  const label = fieldLabel(fields, condition.sourceFieldId);
  switch (condition.op) {
    case "answered": return `${label} is answered`;
    case "empty": return `${label} is empty`;
    case "eq": return `${label} is ${describeValue(fields, condition)}`;
    case "neq": return `${label} is not ${describeValue(fields, condition)}`;
    case "in": return `${label} is any of ${describeValue(fields, condition)}`;
    case "not_in": return `${label} is none of ${describeValue(fields, condition)}`;
  }
}

function conditionsPhrase(rule: Pick<VisibilityRule, "match" | "conditions">, fields: readonly SummaryField[]): string {
  const joiner = rule.match === "all" ? " and " : " or ";
  return rule.conditions.map((condition) => conditionPhrase(condition, fields)).join(joiner);
}

function isRoutingRule(rule: VisibilityRule | RoutingRule): rule is RoutingRule {
  return "addTagIds" in rule;
}

/**
 * The plain-English line under a visibility editor ("Shown when Format is any
 * of Workshop.") and on a routing-rule card ("When Track is AI Infrastructure
 * → set Track Infrastructure, add tag Workshop"). One function, so the copy
 * never drifts between the two surfaces.
 */
export function ruleSummary(
  rule: VisibilityRule | RoutingRule,
  fields: readonly SummaryField[],
  vocab: { tracks: readonly TrackDTO[]; tags: readonly TagDTO[] },
): string {
  const conditions = conditionsPhrase(rule, fields);
  if (!isRoutingRule(rule)) return `Shown when ${conditions}.`;

  const actions: string[] = [];
  if (rule.setTrackId) {
    const track = vocab.tracks.find((candidate) => candidate.id === rule.setTrackId);
    actions.push(`set Track ${track?.name ?? "(deleted track)"}`);
  }
  for (const tagId of rule.addTagIds) {
    const tag = vocab.tags.find((candidate) => candidate.id === tagId);
    actions.push(`add tag ${tag?.name ?? "(deleted tag)"}`);
  }
  const actionPhrase = actions.length > 0 ? actions.join(", ") : "leave the submission Uncategorized";
  return `When ${conditions} → ${actionPhrase}`;
}
