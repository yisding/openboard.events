/** @vitest-environment happy-dom */

import * as React from "react";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { fieldIdSchema, type Condition } from "@/shared/contracts";
import { evaluateCondition } from "@/shared/lib/conditions";
import { ConditionRow, type ConditionSourceField } from "./condition-row";
import { ruleSummary } from "./rule-summary";

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const topics = fieldIdSchema.parse("40000000-0000-4000-8000-000000000001");

const multiselect: ConditionSourceField = {
  id: topics,
  label: "Topics",
  fieldType: "multiselect",
  options: [
    { id: "frontend", label: "Frontend" },
    { id: "backend", label: "Backend" },
  ],
};

const format = fieldIdSchema.parse("40000000-0000-4000-8000-000000000002");

const dropdown: ConditionSourceField = {
  id: format,
  label: "Format",
  fieldType: "dropdown",
  options: [
    { id: "talk", label: "Talk" },
    { id: "workshop", label: "Workshop" },
  ],
};

const mounted: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()?.();
});

/** Holds the condition the way the real editors do, so a change round-trips. */
function ConditionFixture({ initial }: { initial: Condition }) {
  const [condition, setCondition] = useState(initial);
  return (
    <>
      <ConditionRow
        condition={condition}
        sourceFields={[multiselect, dropdown]}
        onChange={setCondition}
        onRemove={() => undefined}
      />
      <output data-testid="value">{JSON.stringify(condition.value)}</output>
    </>
  );
}

async function render(initial: Condition): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<ConditionFixture initial={initial} />));
  mounted.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  return container;
}

const valueOf = (container: HTMLElement) => container.querySelector('[data-testid="value"]')?.textContent;
const chips = (container: HTMLElement) => container.querySelectorAll('.chip-picker button');
const valueSelect = (container: HTMLElement) => container.querySelector<HTMLSelectElement>('select[aria-label="Value"]');

describe("ConditionRow value arity", () => {
  it("offers one option under 'is', not a multi-chip picker", async () => {
    const container = await render({ sourceFieldId: topics, op: "eq", value: "frontend" });
    expect(chips(container)).toHaveLength(0);
    expect(valueSelect(container)).not.toBeNull();
  });

  it("offers the chip picker under 'is any of'", async () => {
    const container = await render({ sourceFieldId: topics, op: "in", value: ["frontend"] });
    expect(chips(container)).toHaveLength(2);
  });

  it("drops a multi-value selection when the operator stops taking a set", async () => {
    // The exact sequence that used to build "Topics is Frontend, Backend": pick
    // two chips under "is any of", then switch the operator to "is".
    const container = await render({ sourceFieldId: topics, op: "in", value: ["frontend"] });
    const [, backend] = [...chips(container)] as HTMLButtonElement[];
    await act(async () => backend?.click());
    expect(valueOf(container)).toBe(JSON.stringify(["frontend", "backend"]));

    const operator = container.querySelector<HTMLSelectElement>('select[aria-label="Operator"]');
    if (!operator) throw new Error("operator select did not render");
    await act(async () => {
      operator.value = "eq";
      operator.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // A single value, so what the summary says and what the evaluator reads are
    // the same thing — not a two-element array with only its head consulted.
    expect(valueOf(container)).toBe(JSON.stringify("frontend"));
    expect(chips(container)).toHaveLength(0);
  });

  it("keeps a dropdown's selection when the operator changes", async () => {
    // A dropdown is scalar under every operator, so nothing needs reshaping —
    // and snapping it back to the first option would save a rule against a
    // value the organizer never chose.
    const container = await render({ sourceFieldId: format, op: "eq", value: "workshop" });
    const operator = container.querySelector<HTMLSelectElement>('select[aria-label="Operator"]');
    if (!operator) throw new Error("operator select did not render");
    await act(async () => {
      operator.value = "in";
      operator.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(valueOf(container)).toBe(JSON.stringify("workshop"));
  });

  it("carries a multiselect's choice into the set form instead of resetting it", async () => {
    const container = await render({ sourceFieldId: topics, op: "eq", value: "backend" });
    const operator = container.querySelector<HTMLSelectElement>('select[aria-label="Operator"]');
    if (!operator) throw new Error("operator select did not render");
    await act(async () => {
      operator.value = "in";
      operator.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(valueOf(container)).toBe(JSON.stringify(["backend"]));
  });

  it("shows the value a legacy multi-value 'is' actually compares against", async () => {
    // Stored before the builder stopped offering a set here. The control used
    // to fall back to the disabled placeholder, so the editor contradicted both
    // the evaluator and the summary line above it.
    const container = await render({ sourceFieldId: topics, op: "eq", value: ["backend", "frontend"] });
    expect(valueSelect(container)?.value).toBe("backend");
  });
});

describe("rule summary for a legacy multi-value eq", () => {
  // The builder can no longer save this, but rules written before it stopped
  // can still hold it, and the summary used to read as an OR.
  const legacy: Condition = { sourceFieldId: topics, op: "eq", value: ["frontend", "backend"] };
  const fields = [{ id: topics, label: "Topics", options: multiselect.options }];

  it("describes only the value the evaluator actually compares", () => {
    const summary = ruleSummary(
      { match: "all", conditions: [legacy] } as Parameters<typeof ruleSummary>[0],
      fields,
      { tracks: [], tags: [] },
    );
    expect(summary).toContain("Topics is Frontend");
    expect(summary).not.toContain("Backend");
  });

  it("agrees with the evaluator on a respondent who picked both", () => {
    // Both selected is *not* a match — `equals` wants an exact singleton — so a
    // summary promising "Frontend, Backend" was describing a rule that fires
    // for neither of the people who read it that way.
    expect(evaluateCondition(legacy, { [topics]: { t: "opts", v: ["frontend", "backend"] } })).toBe(false);
    expect(evaluateCondition(legacy, { [topics]: { t: "opts", v: ["frontend"] } })).toBe(true);
  });
});
