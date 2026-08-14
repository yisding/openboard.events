import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function route(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("runtime form snapshot transactions", () => {
  it.each([
    ["section PATCH", "../../../app/api/internal/forms/[formId]/sections/[sectionId]/route.ts", "updateSectionIn(tx,"],
    ["field PATCH", "../../../app/api/internal/forms/[formId]/fields/[fieldId]/route.ts", "updateFieldIn(tx,"],
    ["field DELETE", "../../../app/api/internal/forms/[formId]/fields/[fieldId]/route.ts", "deleteFieldIn(tx,"],
    ["field reorder", "../../../app/api/internal/forms/[formId]/fields/reorder/route.ts", "reorderFieldsIn(\n    tx,"],
    ["field create", "../../../app/api/internal/forms/[formId]/fields/route.ts", "createFieldIn(tx,"],
    ["Participant step", "../../../app/api/internal/forms/[formId]/participant-step/route.ts", "updateParticipantStepWithReplayIn(\n      tx,"],
  ])("keeps %s authoring and its snapshot in one transaction", (_name, path, mutation) => {
    const source = route(path);
    expect(source).toContain("withTx((tx) =>");
    expect(source).toContain(mutation);
  });
});
