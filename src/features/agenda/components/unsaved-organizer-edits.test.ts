import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isSessionDraftDirty, type SessionDraft } from "./session-form-dialog";

const sessionDraft: SessionDraft = {
  title: "Opening keynote",
  descriptionHtml: "<p>Welcome</p>",
  formatId: "format-1",
  trackId: "track-1",
  roomId: "room-1",
  startsAt: "2026-09-01T16:00:00.000Z",
  endsAt: "2026-09-01T16:30:00.000Z",
  speakerContactIds: ["contact-1"],
  status: "draft",
};

describe("organizer unsaved-edit guards", () => {
  it("detects session field and speaker changes against the loaded draft", () => {
    expect(isSessionDraftDirty({ ...sessionDraft }, sessionDraft)).toBe(false);
    expect(isSessionDraftDirty({ ...sessionDraft, title: "Updated keynote" }, sessionDraft)).toBe(true);
    expect(isSessionDraftDirty({ ...sessionDraft, speakerContactIds: ["contact-1", "contact-2"] }, sessionDraft)).toBe(true);
  });

  it("guards agenda close, Escape/backdrop, and Cancel while preserving save/delete closes", () => {
    const source = readFileSync(new URL("./session-form-dialog.tsx", import.meta.url), "utf8");

    expect(source).toContain("useUnsavedWorkGuard(open && dirty)");
    expect(source).toContain("runGuarded(() => {");
    expect(source).toContain("setDraft(original);");
    expect(source).toContain("onClose={requestClose}");
    expect(source).toContain('variant="secondary" onClick={requestClose}');
    expect(source).toContain('toast(session ? "Session updated" : "Session created");\n      onClose();');
    expect(source).toContain('toast("Session deleted");\n      onClose();');
  });

  it("guards abstract close, row changes, keyboard flow, and next/previous while edits are dirty", () => {
    const drawer = readFileSync(new URL("../../submissions/components/submission-drawer.tsx", import.meta.url), "utf8");
    const view = readFileSync(new URL("../../submissions/components/abstracts-view.tsx", import.meta.url), "utf8");

    expect(drawer).toContain("useUnsavedWorkGuard(dirty)");
    expect(view).toContain("runGuarded(() => setOpenId(submissionId))");
    expect(view).toContain("onNavigate: requestDrawerTarget");
    expect(view).toContain("onClose: () => requestDrawerTarget(null)");
    expect(view).toContain("onRowClick={(row) => requestDrawerTarget(row.submissionId)}");
    expect(view).toContain("onClose={() => requestDrawerTarget(null)}");
    expect(view).toContain("onPrev: () => requestDrawerTarget(");
    expect(view).toContain("onNext: () => requestDrawerTarget(");
    expect(view).toContain("if (drawerBusy || submissionId === openId) return;");
  });

  it("uses copy that applies to every guarded editor", () => {
    const source = readFileSync(new URL("../../../shared/ui/app/unsaved-work-guard.tsx", import.meta.url), "utf8");

    expect(source).toContain("Your unsaved changes will be lost");
    expect(source).not.toContain("score, notes, or recusal reason");
  });
});
