"use client";

import type { Condition, VisibilityRule } from "@/shared/contracts";
import { Button, Segmented, Select } from "@/shared/ui/ui-kit";
import type { BuilderField } from "../../builder-types";
import { ConditionRow } from "./condition-row";
import { ruleSummary } from "./rule-summary";

const MAX_CONDITIONS = 5;

function defaultCondition(source: BuilderField): Condition {
  if (source.fieldType === "dropdown") return { sourceFieldId: source.id, op: "eq", value: source.options[0]?.id ?? "" };
  return { sourceFieldId: source.id, op: "answered" };
}

/**
 * The one-level visibility editor mounted in M12's field drawer. `onChange`
 * only — persistence is the drawer's own field save (one Save, one compiled
 * snapshot), never a separate endpoint here (module guardrail: "Snapshot
 * discipline").
 */
export function VisibilityRuleEditor({
  field,
  earlierFields,
  value,
  onChange,
}: {
  field: BuilderField;
  earlierFields: BuilderField[];
  value: VisibilityRule | null;
  onChange: (rule: VisibilityRule | null) => void;
}) {
  if (earlierFields.length === 0) {
    return (
      <div className="condition-card visibility-rule-editor">
        <div>
          <b>Conditional visibility</b>
          <small>Only fields above this one can control its visibility.</small>
        </div>
      </div>
    );
  }

  const mode: "always" | "conditional" = value ? "conditional" : "always";

  function setMode(next: "always" | "conditional") {
    if (next === "always") {
      onChange(null);
      return;
    }
    const source = earlierFields[0];
    if (!source) return;
    onChange({ match: "all", conditions: [defaultCondition(source)] });
  }

  function updateCondition(index: number, condition: Condition) {
    if (!value) return;
    onChange({ ...value, conditions: value.conditions.map((candidate, candidateIndex) => candidateIndex === index ? condition : candidate) });
  }

  function removeCondition(index: number) {
    if (!value || value.conditions.length <= 1) return;
    onChange({ ...value, conditions: value.conditions.filter((_, candidateIndex) => candidateIndex !== index) });
  }

  function addCondition() {
    if (!value || value.conditions.length >= MAX_CONDITIONS) return;
    const source = earlierFields[0];
    if (!source) return;
    onChange({ ...value, conditions: [...value.conditions, defaultCondition(source)] });
  }

  return (
    <div className="condition-card visibility-rule-editor">
      <div>
        <b>Conditional visibility for &ldquo;{field.label}&rdquo;</b>
        <small>Conditions may reference only earlier questions.</small>
      </div>
      <Segmented
        label={`Visibility for ${field.label}`}
        value={mode}
        onChange={setMode}
        items={[{ value: "always", label: "Always visible" }, { value: "conditional", label: "Show when…" }]}
      />
      {value && (
        <div className="visibility-rule-editor__body">
          <label className="match-select">
            <span>Show this field when</span>
            <Select value={value.match} onChange={(event) => onChange({ ...value, match: event.target.value as "all" | "any" })}>
              <option value="all">all of the following</option>
              <option value="any">any of the following</option>
            </Select>
          </label>
          <div className="condition-rows">
            {value.conditions.map((condition, index) => (
              <ConditionRow
                key={index}
                condition={condition}
                sourceFields={earlierFields}
                onChange={(next) => updateCondition(index, next)}
                onRemove={() => removeCondition(index)}
                removable={value.conditions.length > 1}
              />
            ))}
          </div>
          {/* `add-condition`, not `add-question`: it shares the styling but it
              is not that control, and the tour addresses the builder's Add
              question by that class. Two buttons answering one selector is a
              spotlight waiting to land on the wrong one. */}
          <Button variant="ghost" className="add-condition" disabled={value.conditions.length >= MAX_CONDITIONS} onClick={addCondition}>
            Add condition
          </Button>
          {value.conditions.length >= MAX_CONDITIONS && <small>Up to 5 conditions</small>}
          <p className="rule-summary-line">{ruleSummary(value, earlierFields, { tracks: [], tags: [] })}</p>
        </div>
      )}
    </div>
  );
}
