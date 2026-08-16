import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("file request editor unsaved-work guard", () => {
  it("guards dirty dismissal and preserves in-flight create state", () => {
    const source = readFileSync(new URL("./file-requests-view.tsx", import.meta.url), "utf8");

    expect(source).toContain("useUnsavedWorkGuard(dirty)");
    expect(source).toContain("requestGuardedEditorClose({ busy: saving, dirty, runGuarded, close: discardEditor })");
    expect(source).toContain('onClick={closeEditor} disabled={saving}');
    expect(source).toContain("inert={saving || undefined}");
    expect(source).toContain("setBaseline(draft)");
    expect(source.indexOf("setBaseline(draft)")).toBeLessThan(source.indexOf("discardEditor();"));
    // The baseline reset only lands on the next render, so the guard is retired
    // by hand before `onChanged` refreshes the list — otherwise the app's own
    // post-save refresh met a discard prompt about an already-committed write.
    expect(source.indexOf("releaseUnsavedWork();")).toBeLessThan(source.indexOf("await onChanged"));
  });

  it("resets create identity only through confirmed discard or successful save", () => {
    const source = readFileSync(new URL("./file-requests-view.tsx", import.meta.url), "utf8");
    const discard = source.slice(source.indexOf("function discardEditor"), source.indexOf("async function save"));

    expect(discard).toContain("createRequestId.current.reset()");
    expect(discard).toContain("requestGuardedEditorClose");
    expect(source).not.toContain("onClose={discardEditor}");
  });

  it("does not reopen an editor while the saved list is still refreshing", () => {
    const source = readFileSync(new URL("./file-requests-view.tsx", import.meta.url), "utf8");
    const startCreate = source.slice(source.indexOf("function startCreate"), source.indexOf("function startEdit"));
    const startEdit = source.slice(source.indexOf("function startEdit"), source.indexOf("function discardEditor"));
    const savedFlow = source.slice(source.indexOf("setBaseline(draft)"), source.indexOf("async function remove"));

    expect(startCreate).toContain("if (saving) return");
    expect(startEdit).toContain("if (saving) return");
    expect(source).toContain('onClick={startCreate} disabled={saving}');
    expect(source).toContain('onClick={() => startEdit(request)} disabled={saving}');
    expect(savedFlow.indexOf("discardEditor();")).toBeLessThan(savedFlow.indexOf("await onChanged"));
    expect(savedFlow.indexOf("await onChanged")).toBeLessThan(savedFlow.indexOf("setSaving(false)"));
  });
});
