"use client";

import { X } from "lucide-react";
import { CONDITION_OPS, type Condition, type ConditionOp, type FieldType } from "@/shared/contracts";
import { Select } from "@/shared/ui/ui-kit";
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
/**
 * The operators that take a *set*. `eq`/`neq` are deliberately not here:
 * `expectedScalar` in `shared/lib/conditions.ts` reads `value[0]` and nothing
 * else, and `equals` then demands an exact singleton match. Offering a
 * multi-chip picker under "is" therefore built a rule reading "Topics is
 * Frontend, Backend" that only ever matched Frontend — and matched neither for
 * a respondent who picked both. `in`/`not in` are the set forms, and the
 * contract file says so.
 */
const MULTI_VALUE_OPS = new Set<ConditionOp>(["in", "not_in"]);

/**
 * Options the server has actually saved an id for.
 *
 * The builder mints `draft-N` placeholders for option lines with no saved id to
 * claim yet, and `FieldInspector` builds its source list from live builder
 * state — so an unsaved option could be picked here and stored as
 * `condition.value`. The server then minted a real UUID for the option while
 * the rule kept the placeholder, leaving the dependent question permanently
 * hidden (or, with "is not", permanently shown) with nothing refused and
 * nothing to see but "Shown when Format is draft-2" after a reload. The server
 * refuses that now; this keeps it out of reach in the first place.
 */
function savedOptions(field: { options: readonly { id: string; label: string }[] }): { id: string; label: string }[] {
  return field.options.filter((option) => !option.id.startsWith("draft-"));
}

/** Whether this field/operator pair holds a set of option ids or a single value. */
function wantsArray(op: ConditionOp, field: ConditionSourceField | undefined): boolean {
  return field?.fieldType === "multiselect" && MULTI_VALUE_OPS.has(op);
}

/**
 * Carry the organizer's choice across an operator change, reshaping it when the
 * new operator holds a different shape.
 *
 * Only a multiselect ever changes shape — a dropdown and a text field stay
 * scalar under every operator, so their value must survive untouched rather
 * than snapping back to the first option.
 */
function valueForOp(
  op: ConditionOp,
  field: ConditionSourceField | undefined,
  current: Condition["value"],
): Condition["value"] {
  if (!VALUE_REQUIRED_OPS.has(op)) return undefined;
  if (current === undefined) return defaultValueFor(op, field);
  const isArray = Array.isArray(current);
  if (wantsArray(op, field)) return isArray ? current : current === "" ? defaultValueFor(op, field) : [current];
  const scalar = isArray ? current[0] : current;
  return scalar === undefined ? defaultValueFor(op, field) : scalar;
}

/**
 * The one value `eq`/`neq` compare against, which is `expectedScalar`'s rule in
 * `shared/lib/conditions.ts`. A rule saved before the builder stopped offering
 * a set under those operators still holds an array; showing its first element
 * is what the evaluator does and what the summary now says, so the control
 * agrees with both instead of rendering an empty placeholder.
 */
function scalarValue(value: Condition["value"]): string {
  const effective = Array.isArray(value) ? value[0] : value;
  return typeof effective === "string" ? effective : "";
}
// A file question has nothing to compare against — only whether it was
// uploaded at all is meaningful.
const FILE_ONLY_OPS: readonly ConditionOp[] = ["answered", "empty"];

function operatorsFor(fieldType: FieldType | undefined): readonly ConditionOp[] {
  return fieldType === "file" ? FILE_ONLY_OPS : CONDITION_OPS;
}

function defaultValueFor(op: ConditionOp, field: ConditionSourceField | undefined): Condition["value"] {
  if (!VALUE_REQUIRED_OPS.has(op)) return undefined;
  if (!field) return "";
  if (field.fieldType === "multiselect" && MULTI_VALUE_OPS.has(op)) return field.options[0] ? [field.options[0].id] : [];
  if (field.fieldType === "multiselect" || field.fieldType === "dropdown") return field.options[0]?.id ?? "";
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
  // How many of the question's options this operator compares against — which
  // is a question about the *operator*, not only about the field. It used to be
  // read off the field alone, which is how a multi-chip "is" got built.
  const optionPicker = sourceField?.fieldType === "multiselect" && MULTI_VALUE_OPS.has(condition.op)
    ? "many"
    : sourceField?.fieldType === "multiselect" || sourceField?.fieldType === "dropdown"
      ? "one"
      : "none";

  function changeSource(nextFieldId: string) {
    const nextField = sourceFields.find((field) => field.id === nextFieldId);
    const nextOps = operatorsFor(nextField?.fieldType);
    const nextOp = nextOps.includes(condition.op) ? condition.op : (nextOps[0] ?? "answered");
    onChange({ sourceFieldId: nextFieldId as Condition["sourceFieldId"], op: nextOp, value: defaultValueFor(nextOp, nextField) });
  }

  function changeOp(nextOp: ConditionOp) {
    // Carrying the value across unchanged is what let a two-chip array survive
    // a switch from "is any of" to "is", where only the first element is ever
    // read. Reshaping keeps the organizer's choice without keeping the shape.
    onChange({ ...condition, op: nextOp, value: valueForOp(nextOp, sourceField, condition.value) });
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
        <Select
          aria-label="Source question"
          disabled={disabled}
          value={condition.sourceFieldId}
          onChange={(event) => changeSource(event.target.value)}
        >
          {sourceFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
        </Select>
        <Select
          aria-label="Operator"
          disabled={disabled}
          value={condition.op}
          onChange={(event) => changeOp(event.target.value as ConditionOp)}
        >
          {allowedOps.map((op) => <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>)}
        </Select>
        {/* One option, because "is"/"is not" compares against one. A
            multiselect question under those operators asks the same
            single-answer question a dropdown does. */}
        {requiresValue && sourceField && optionPicker === "one" && (
          <Select aria-label="Value" disabled={disabled} value={scalarValue(condition.value)} onChange={(event) => changeScalarValue(event.target.value)}>
            <option value="" disabled>Choose an option</option>
            {savedOptions(sourceField).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </Select>
        )}
        {requiresValue && sourceField && optionPicker === "many" && (
          <div className="condition-row__chips chip-picker" role="group" aria-label="Value">
            {savedOptions(sourceField).map((option) => {
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
        {requiresValue && sourceField && optionPicker === "none" && (
          <input
            aria-label="Value"
            disabled={disabled}
            value={scalarValue(condition.value)}
            onChange={(event) => changeScalarValue(event.target.value)}
            placeholder="Value to match"
          />
        )}
        <button type="button" className="icon-button condition-row__remove" aria-label="Remove condition" disabled={disabled || !removable} onClick={onRemove}>
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
