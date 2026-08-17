import { describe, expect, it } from "vitest";
import { fieldIdSchema } from "@/shared/contracts";
import { GOLDEN_AUTHORING_ROWS, GOLDEN_SNAPSHOT } from "@/shared/fixtures/form-snapshot";
import { AppError } from "./errors";
import { compileFormSnapshot } from "./form-snapshot";

describe("compileFormSnapshot", () => {
  it("compiles the golden authoring rows deterministically", () => {
    expect(compileFormSnapshot(GOLDEN_AUTHORING_ROWS)).toEqual(GOLDEN_SNAPSHOT);
  });

  it("rejects a forward visibility reference with the offending field id", () => {
    const offendingId = fieldIdSchema.parse("00000000-0000-4000-8000-000000000100");
    const forwardId = fieldIdSchema.parse("00000000-0000-4000-8000-000000000109");
    const rows = structuredClone(GOLDEN_AUTHORING_ROWS);
    const field = rows.fields.find((candidate) => candidate.id === offendingId);
    if (!field) throw new Error("fixture field missing");
    field.visibility = { match: "all", conditions: [{ sourceFieldId: forwardId, op: "answered" }] };
    expect(() => compileFormSnapshot(rows)).toThrowError(new RegExp(offendingId));
    expect(() => compileFormSnapshot(rows)).toThrowError(AppError);
  });

  /**
   * The publish-time half of #623. A condition value that names no live option
   * used to compile straight into the snapshot, and the dependent question was
   * then unreachable on the public form with nothing anywhere saying so.
   */
  describe("visibility values that name no live option", () => {
    const WORKSHOP_DURATION = fieldIdSchema.parse("00000000-0000-4000-8000-000000000111");
    const SLIDES = fieldIdSchema.parse("00000000-0000-4000-8000-000000000105");
    const FORMAT = fieldIdSchema.parse("00000000-0000-4000-8000-000000000110");
    const TOPICS = fieldIdSchema.parse("00000000-0000-4000-8000-000000000104");
    const TITLE = fieldIdSchema.parse("00000000-0000-4000-8000-000000000100");

    function withRule(fieldId: string, condition: { sourceFieldId: string; op: "eq" | "in"; value: string | string[] }) {
      const rows = structuredClone(GOLDEN_AUTHORING_ROWS);
      const field = rows.fields.find((candidate) => candidate.id === fieldId);
      if (!field) throw new Error("fixture field missing");
      field.visibility = { match: "all", conditions: [condition] } as typeof field.visibility;
      return rows;
    }

    it("rejects the builder's draft placeholder id", () => {
      const rows = withRule(WORKSHOP_DURATION, { sourceFieldId: FORMAT, op: "eq", value: "draft-2" });
      expect(() => compileFormSnapshot(rows)).toThrow(/draft-2 is not an option of Format/u);
    });

    it("rejects a multi-select rule where only one of the option ids is dead", () => {
      const rows = withRule(SLIDES, { sourceFieldId: TOPICS, op: "in", value: ["safety", "retired-topic"] });
      expect(() => compileFormSnapshot(rows)).toThrow(/retired-topic/u);
    });

    it("leaves a free-text source's value alone", () => {
      const rows = withRule(WORKSHOP_DURATION, { sourceFieldId: TITLE, op: "eq", value: "Workshop" });
      expect(() => compileFormSnapshot(rows)).not.toThrow();
    });
  });

  it("does not require CFP identity fields on portal forms", () => {
    const rows = structuredClone(GOLDEN_AUTHORING_ROWS);
    rows.form.context = "portal";
    rows.fields = rows.fields.filter((field) => field.key === "notes");
    expect(compileFormSnapshot(rows).sections.flatMap((section) => section.fields)).toHaveLength(1);
  });

  it.each([0, 1.5])("rejects invalid maxChars value %s", (maxChars) => {
    const rows = structuredClone(GOLDEN_AUTHORING_ROWS);
    const notes = rows.fields.find((field) => field.key === "notes");
    if (!notes) throw new Error("notes fixture missing");
    notes.maxChars = maxChars;
    expect(() => compileFormSnapshot(rows)).toThrow(/positive integer/u);
  });
});
