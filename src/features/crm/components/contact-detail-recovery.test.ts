import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { reconcileCommittedCrmWrite } from "./contact-detail-view";

describe("CRM contact write recovery", () => {
  const source = readFileSync(new URL("./contact-detail-view.tsx", import.meta.url), "utf8");

  it("distinguishes a committed write from follow-up reconciliation", async () => {
    const refreshed = vi.fn(async () => undefined);
    const failedRefresh = vi.fn(async () => { throw new Error("offline"); });

    await expect(reconcileCommittedCrmWrite(refreshed)).resolves.toBe(true);
    await expect(reconcileCommittedCrmWrite(failedRefresh)).resolves.toBe(false);
  });

  it("keeps drafts guarded and preserves note text until acknowledgement", () => {
    expect(source).toContain("useUnsavedWorkGuard(fieldsDirty || customDirty || noteBody.trim().length > 0)");
    expect(source).toContain("noteId: noteCreateId.current.begin()");
    const request = source.indexOf("const note = await api(");
    expect(request).toBeGreaterThan(0);
    expect(source.indexOf('setNoteBody("")', request)).toBeGreaterThan(request);
    expect(source.indexOf("noteCreateId.current.reset()", request)).toBeGreaterThan(request);
  });

  it("updates acknowledged state locally and reports refresh failure truthfully", () => {
    expect(source).toContain("setHistory((current) => ({ ...current, contact: { ...current.contact, ...patch } }))");
    expect(source).toContain("latest contact history could not be reloaded. Refresh before making another change.");
    expect(source).toContain('await finishCommittedWrite("Contact saved")');
    expect(source).toContain('await finishCommittedWrite("Note saved")');
    expect(source).not.toContain('toast("Note added")');
  });
});
