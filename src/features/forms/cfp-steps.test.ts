import { describe, expect, it } from "vitest";
import { GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import { stepForErrors } from "./components/cfp-steps";

const fieldId = (key: string) => {
  const field = GOLDEN_SNAPSHOT.sections.flatMap((section) => section.fields).find((candidate) => candidate.key === key);
  if (!field) throw new Error(`Missing field ${key}`);
  return field.id;
};

describe("CFP validation routing", () => {
  it("returns participant errors to the speaker step", () => {
    expect(stepForErrors(GOLDEN_SNAPSHOT, { [fieldId("first_name")]: "First name is required" })).toBe("speaker");
  });

  it("returns abstract errors to the submission step", () => {
    expect(stepForErrors(GOLDEN_SNAPSHOT, { [fieldId("title")]: "Title is required" })).toBe("submission");
  });
});
