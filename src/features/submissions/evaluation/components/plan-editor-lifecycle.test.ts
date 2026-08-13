import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { editorDraftChanged, requestGuardedEditorClose } from "@/shared/ui/app/modal-editor-guard";

describe("evaluation plan editor lifecycle", () => {
  const source = readFileSync(new URL("./plan-editor.tsx", import.meta.url), "utf8");

  it("derives dirty state from an immutable baseline and protects partial saves", () => {
    expect(source).toContain("const [baseline] = useState<PlanDraft>");
    expect(source).toContain("pendingReviewerPlanId !== null || editorDraftChanged(draft, baseline)");
    expect(source).toContain("useUnsavedWorkGuard(dirty)");
  });

  it("routes every dismiss gesture through one guarded close and bypasses it after success", () => {
    expect(source).toContain("function closeEditor()");
    expect(source).toContain("requestGuardedEditorClose({ busy: saving, dirty, runGuarded, close: onClose })");
    expect(source).toContain("<Drawer open onClose={closeEditor}");
    expect(source).toContain('disabled={saving} onClick={closeEditor}>Cancel');
    expect(source).toMatch(/toast\(plan \? `\$\{draft\.name\} updated` : `\$\{draft\.name\} created`\);\s+onClose\(\);/u);
  });

  it("allows pristine close, confirms dirty close, and suppresses close while saving", () => {
    const close = vi.fn();
    const runGuarded = vi.fn((action: () => void) => action());

    expect(requestGuardedEditorClose({ busy: false, dirty: false, runGuarded, close })).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(runGuarded).not.toHaveBeenCalled();

    expect(requestGuardedEditorClose({ busy: false, dirty: true, runGuarded, close })).toBe(true);
    expect(runGuarded).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledTimes(2);

    expect(requestGuardedEditorClose({ busy: true, dirty: true, runGuarded, close })).toBe(false);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("recognizes edits and exact reverts", () => {
    const baseline = { name: "Round 1", reviewers: [{ userId: "reviewer-1", trackIds: [] }] };
    expect(editorDraftChanged(baseline, baseline)).toBe(false);
    expect(editorDraftChanged({ ...baseline, name: "Round 2" }, baseline)).toBe(true);
    expect(editorDraftChanged({ ...baseline }, baseline)).toBe(false);
  });

  it("makes reviewer score visibility an explicit round setting", () => {
    expect(source).toContain("showPeerScores: false");
    expect(source).toContain("Share committee averages");
    expect(source).toContain('label="Share committee averages with reviewers"');
    expect(source).toContain("showPeerScores: draft.showPeerScores");
  });
});
