import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("portal accessibility regressions", () => {
  it("keeps resource deletion confirmation open and reports every failure as an error", () => {
    const resourcePages = source("./resources/components/resource-pages-admin-view.tsx");

    expect(resourcePages).toContain("async function remove(page: ResourcePageRow): Promise<boolean>");
    expect(resourcePages).toContain("if (pendingDelete && await remove(pendingDelete)) setPendingDelete(null);");
    expect(resourcePages).toContain('toast(payload?.error?.message ?? "That page could not be deleted", { kind: "error" });');
    expect(resourcePages).toContain('toast("Could not reorder pages", { kind: "error" });');
  });

  it("focuses server-invalid task and submission fields and clears a corrected field error", () => {
    for (const path of [
      "./task-runtime/components/task-detail.tsx",
      "./submissions-edit/components/edit-submission-form.tsx",
    ]) {
      const form = source(path);
      expect(form).toContain("formPanelRef.current?.querySelector<HTMLElement>('[aria-invalid=\"true\"]')?.focus()");
      expect(form).toContain("function changeAnswer(fieldId: string, value: AnswerValue | undefined)");
      expect(form).toContain("delete next[fieldId]");
      expect(form).toContain("onChange={changeAnswer}");
    }
  });

  it("uses error toast semantics for every portal form-builder mutation failure", () => {
    const builder = source("./form-builder/components/portal-form-builder.tsx");
    for (const message of [
      "The form could not be saved",
      "The field could not be added",
      "The question could not be added",
      "The question could not be saved",
      "The question could not be removed",
      "The question order could not be saved",
    ]) {
      expect(builder).toContain(`: "${message}", { kind: "error" });`);
    }
  });
});
