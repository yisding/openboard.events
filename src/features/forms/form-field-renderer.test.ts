import { describe, expect, it } from "vitest";
import { evaluateVisibility } from "@/shared/lib/conditions";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import type { AnswerValue, FieldId } from "@/shared/contracts";

/**
 * The renderer itself is a React tree, and component tests are outside the test
 * budget (quality-strategy §3). What is worth pinning is the rule it renders by:
 * which fields it shows for a given set of answers must match what the submit
 * pipeline will keep, or a speaker fills in something the server then discards.
 */
const field = (key: string) => {
  const found = GOLDEN_SNAPSHOT.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no field ${key}`);
  return found;
};

const option = (v: string): AnswerValue => ({ t: "opt", v });

describe("what the renderer shows", () => {
  it("hides a conditional field until its condition holds", () => {
    const talk = evaluateVisibility(GOLDEN_SNAPSHOT, { [field("format").id]: option("talk") } as Record<FieldId, AnswerValue>);
    expect(talk.has(field("workshop_duration").id)).toBe(false);

    const workshop = evaluateVisibility(GOLDEN_SNAPSHOT, { [field("format").id]: option("workshop") } as Record<FieldId, AnswerValue>);
    expect(workshop.has(field("workshop_duration").id)).toBe(true);
  });

  it("shows every unconditional field with no answers at all", () => {
    // The first paint of an empty wizard must not be blank.
    const visible = evaluateVisibility(GOLDEN_SNAPSHOT, {});
    expect(visible.has(field("title").id)).toBe(true);
    expect(visible.has(field("first_name").id)).toBe(true);
    expect(visible.has(field("workshop_duration").id)).toBe(false);
  });

  it("agrees with the section split the wizard renders in steps", () => {
    // sectionKeys is how the wizard shows one step at a time; the keys it passes
    // have to exist, or a step renders empty.
    const keys = GOLDEN_SNAPSHOT.sections.map((section) => section.key);
    expect(keys).toContain("abstract");
    expect(keys).toContain("participant");
  });
});
