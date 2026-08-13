import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AdminTaskDTO } from "../server/queries";
import { draftFromTask, withoutFieldError } from "./task-editor";

const sourceTask = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Upload slides",
  descriptionHtml: "<p>PDF or Keynote</p>",
  targetType: "submission",
  completionMode: "file_request",
  formId: null,
  fileRequestId: "00000000-0000-4000-8000-000000000002",
  dueAt: "2026-11-01T23:59:59.999Z",
  isActive: true,
  createdAt: "2026-08-11T00:00:00.000Z",
  counts: { completed: 2, open: 3, overdue: 1 },
} as AdminTaskDTO;

describe("TaskEditor validation accessibility", () => {
  it("renders field errors with associations and focuses the first invalid control", () => {
    const source = readFileSync(new URL("./task-editor.tsx", import.meta.url), "utf8");

    expect(source).toContain("error={fieldErrors.name}");
    expect(source).toContain('errorId="task-name-error"');
    expect(source).toContain('aria-describedby={fieldErrors.name ? "task-name-error" : undefined}');
    expect(source).toContain("error={fieldErrors.completionMode}");
    expect(source).toContain("querySelector<HTMLElement>('[aria-invalid=\"true\"]')?.focus()");
  });

  it("clears only the corrected field's stale server error", () => {
    const errors = { name: "Required", dueAt: "Invalid date" };
    expect(withoutFieldError(errors, "name")).toEqual({ dueAt: "Invalid date" });
    expect(withoutFieldError(errors, "targetType")).toBe(errors);
  });

  it("guards dirty dismissals and locks the editor during save", () => {
    const source = readFileSync(new URL("./task-editor.tsx", import.meta.url), "utf8");

    expect(source).toContain("useUnsavedWorkGuard(dirty)");
    expect(source).toContain("requestGuardedEditorClose({ busy: saving, dirty, runGuarded, close: discardEditor })");
    expect(source).toContain("inert={saving || undefined}");
    expect(source).toContain('onClick={closeEditor} disabled={saving}');
    expect(source.indexOf("setBaseline(draft)")).toBeLessThan(source.indexOf("await onSaved(saved.data)"));
  });

  it("copies editable task configuration without identity, completions, or active state", () => {
    const copy = draftFromTask(sourceTask, "UTC", true);

    expect(copy).toEqual({
      name: "Upload slides (copy)",
      descriptionHtml: "<p>PDF or Keynote</p>",
      targetType: "submission",
      completionMode: "file_request",
      formId: null,
      fileRequestId: "00000000-0000-4000-8000-000000000002",
      dueAt: "2026-11-01",
      isActive: false,
    });
    expect(copy).not.toHaveProperty("counts");
    expect(copy).not.toHaveProperty("id");
  });

  it("forces the duplicate's first create inactive and explains the activation step", () => {
    const source = readFileSync(new URL("./task-editor.tsx", import.meta.url), "utf8");

    expect(source).toContain("isActive: duplicating ? false : draft.isActive");
    expect(source).toContain('title={draft.id ? "Edit task" : duplicating ? "Duplicate task" : "Create a task"}');
    expect(source).toContain('disabled={duplicating}');
    expect(source).toContain("Create inactive copy");
    expect(source).toContain("until you deliberately activate it");
  });
});
