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

  it("does not require CFP identity fields on portal forms", () => {
    const rows = structuredClone(GOLDEN_AUTHORING_ROWS);
    rows.form.context = "portal";
    rows.fields = rows.fields.filter((field) => field.key === "notes");
    expect(compileFormSnapshot(rows).sections.flatMap((section) => section.fields)).toHaveLength(1);
  });
});
