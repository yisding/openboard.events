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
  });

  it("resets create identity only through confirmed discard or successful save", () => {
    const source = readFileSync(new URL("./file-requests-view.tsx", import.meta.url), "utf8");
    const discard = source.slice(source.indexOf("function discardEditor"), source.indexOf("async function save"));

    expect(discard).toContain("createRequestId.current.reset()");
    expect(discard).toContain("requestGuardedEditorClose");
    expect(source).not.toContain("onClose={discardEditor}");
  });
});
