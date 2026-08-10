"use client";

import { X } from "lucide-react";
import { CONDITION_OPS, type Condition, type ConditionOp, type FieldType } from "@/shared/contracts";
import type { BuilderField } from "../../builder-types";

export type ConditionSourceField = Pick<BuilderField, "id" | "label" | "fieldType" | "options">;

const OPERATOR_LABEL: Record<ConditionOp, string> = {
  eq: "is",
  neq: "is not",
  in: "is any of",
  not_in: "is none of",
  answered: "is answered",
  empty: "is empty",
};

const VALUE_REQUIRED_OPS = new Set<ConditionOp>(["eq", "neq", "in", "not_in"]);
// A file question has nothing to compare against — only whether it was
// uploaded at all is meaningful.
const FILE_ONLY_OPS: readonly ConditionOp[] = ["answered", "empty"];

function operatorsFor(fieldType: FieldType | undefined): readonly ConditionOp[] {
  return fieldType === "file" ? FILE_ONLY_OPS : CONDITION_OPS;
}

function defaultValueFor(op: ConditionOp, field: ConditionSourceField | undefined): Condition["value"] {
  if (!VALUE_REQUIRED_OPS.has(op)) return undefined;
  if (!field) return "";
  if (field.fieldType === "multiselect") return field.options[0] ? [field.options[0].id] : [];
  if (field.fieldType === "dropdown") return field.options[0]?.id ?? "";
  return "";
}

/**
 * One condition: source field · operator · value. Shared by
 * `<VisibilityRuleEditor>` (source list = strictly earlier fields, which is
 * what makes a visibility cycle impossible by construction) and
 * `<RoutingRulesPanel>`'s rule editor (source list = every live field, order
 * does not matter for a post-submit routing rule).
 */
export function ConditionRow({
  condition,
  sourceFields,
  onChange,
  onRemove,
  removable = true,
  highlighted = false,
  disabled = false,
}: {
  condition: Condition;
  sourceFields: ConditionSourceField[];
  onChange: (condition: Condition) => void;
  onRemove: () => void;
  removable?: boolean;
  highlighted?: boolean;
  disabled?: boolean;
}) {
  const sourceField = sourceFields.find((field) => field.id === condition.sourceFieldId);
  const allowedOps = operatorsFor(sourceField?.fieldType);
  const requiresValue = VALUE_REQUIRED_OPS.has(condition.op);

  function changeSource(nextFieldId: string) {
    const nextField = sourceFields.find((field) => field.id === nextFieldId);
    const nextOps = operatorsFor(nextField?.fieldType);
    const nextOp = nextOps.includes(condition.op) ? condition.op : (nextOps[0] ?? "answered");
    onChange({ sourceFieldId: nextFieldId as Condition["sourceFieldId"], op: nextOp, value: defaultValueFor(nextOp, nextField) });
  }

  function changeOp(nextOp: ConditionOp) {
    onChange({ ...condition, op: nextOp, value: VALUE_REQUIRED_OPS.has(nextOp) ? (condition.value ?? defaultValueFor(nextOp, sourceField)) : undefined });
  }

  function changeScalarValue(next: string) {
    onChange({ ...condition, value: next });
  }

  function toggleOption(optionId: string) {
    const current = Array.isArray(condition.value) ? condition.value : [];
    const next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
    onChange({ ...condition, value: next });
  }

  return (
    <div className={`condition-row${highlighted ? " condition-row--highlighted" : ""}`}>
      <div className="condition-row__controls">
        <select
          aria-label="Source question"
          disabled={disabled}
          value={condition.sourceFieldId}
          onChange={(event) => changeSource(event.target.value)}
        >
          {sourceFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
        </select>
        <select
          aria-label="Operator"
          disabled={disabled}
          value={condition.op}
          onChange={(event) => changeOp(event.target.value as ConditionOp)}
        >
          {allowedOps.map((op) => <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>)}
        </select>
        {requiresValue && sourceField?.fieldType === "dropdown" && (
          <select aria-label="Value" disabled={disabled} value={typeof condition.value === "string" ? condition.value : ""} onChange={(event) => changeScalarValue(event.target.value)}>
            <option value="" disabled>Choose an option</option>
            {sourceField.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        )}
        {requiresValue && sourceField?.fieldType === "multiselect" && (
          <div className="condition-row__chips chip-picker" role="group" aria-label="Value">
            {sourceField.options.map((option) => {
              const selected = Array.isArray(condition.value) && condition.value.includes(option.id);
              return (
                <button
                  type="button"
                  key={option.id}
                  disabled={disabled}
                  className={selected ? "chip chip--selected" : "chip"}
                  onClick={() => toggleOption(option.id)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}
        {requiresValue && sourceField && !["dropdown", "multiselect"].includes(sourceField.fieldType) && (
          <input
            aria-label="Value"
            disabled={disabled}
            value={typeof condition.value === "string" ? condition.value : ""}
            onChange={(event) => changeScalarValue(event.target.value)}
            placeholder="Value to match"
          />
        )}
        <button type="button" className="icon-button" aria-label="Remove condition" disabled={disabled || !removable} onClick={onRemove}>
          <X size={14} />
        </button>
      </div>
      {sourceField?.fieldType === "multiselect" && (
        <small className="condition-row__help">
          {"'is any of' matches when the submitter picked at least one of these options."}
        </small>
      )}
      {(condition.op === "neq" || condition.op === "not_in") && (
        <small className="condition-row__help">
          {"A field left blank also counts as 'is not'. Combine with 'is answered' if you need an answer first."}
        </small>
      )}
    </div>
  );
}
