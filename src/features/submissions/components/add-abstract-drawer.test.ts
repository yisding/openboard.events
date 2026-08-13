import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMPTY_ABSTRACT_FIELDS } from "./abstract-fields";
import { manualAbstractCreateOutcomeUnknown, manualAbstractDraftDirty } from "./add-abstract-drawer";

describe("manual abstract creation recovery", () => {
  it("distinguishes an untouched drawer from organizer work", () => {
    expect(manualAbstractDraftDirty(EMPTY_ABSTRACT_FIELDS, "pending", [])).toBe(false);
    expect(manualAbstractDraftDirty({ ...EMPTY_ABSTRACT_FIELDS, title: "Keynote" }, "pending", [])).toBe(true);
    expect(manualAbstractDraftDirty(EMPTY_ABSTRACT_FIELDS, "accepted", [])).toBe(true);
    expect(manualAbstractDraftDirty(EMPTY_ABSTRACT_FIELDS, "pending", ["speaker-1"])).toBe(true);
  });

  it("only locks the form when the create outcome is genuinely ambiguous", () => {
    expect(manualAbstractCreateOutcomeUnknown(null, false)).toBe(true);
    expect(manualAbstractCreateOutcomeUnknown(new Response(null, { status: 503 }), false)).toBe(true);
    expect(manualAbstractCreateOutcomeUnknown(new Response(null, { status: 201 }), false)).toBe(true);
    expect(manualAbstractCreateOutcomeUnknown(new Response(null, { status: 400 }), false)).toBe(false);
  });

  it("freezes one payload for retry and guards every drawer exit", () => {
    const source = readFileSync(new URL("./add-abstract-drawer.tsx", import.meta.url), "utf8");

    expect(source).toContain("attemptRef.current = attempt");
    expect(source).toContain("body: JSON.stringify(attempt)");
    expect(source).toContain("Creation could not be confirmed.");
    expect(source).toContain("Retry abstract creation");
    expect(source).toContain("useUnsavedWorkGuard(open && (dirty || busy), { blocking: busy })");
    expect(source).toContain("onClose={requestClose}");
    expect(source).toContain("onClick={requestClose}>Cancel");
  });

  it("locks every mutable field while recovering, including rich text", () => {
    const drawer = readFileSync(new URL("./add-abstract-drawer.tsx", import.meta.url), "utf8");
    const fields = readFileSync(new URL("./abstract-fields.tsx", import.meta.url), "utf8");
    const richText = readFileSync(new URL("../../../shared/ui/app/rich-text-editor.tsx", import.meta.url), "utf8");

    expect(drawer).toContain("disabled={busy || recoveryRequired}");
    expect(fields).toContain("disabled={disabled}");
    expect(richText).toContain("editor?.setEditable(!disabled)");
    expect(richText).toContain("aria-disabled={disabled || undefined}");
  });
});
