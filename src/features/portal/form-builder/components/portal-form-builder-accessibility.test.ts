import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizePortalFieldLabel, validatePortalFormMetadata } from "./portal-form-builder";

describe("portal form builder destructive actions", () => {
  it("names and confirms question deletion, clearing edit state only on success", () => {
    const source = readFileSync(new URL("./portal-form-builder.tsx", import.meta.url), "utf8");
    const success = source.slice(source.indexOf("async function deleteField"), source.indexOf("async function moveField"));

    expect(source).toContain("<ConfirmDialog");
    expect(source).toContain('title={pendingDelete ? `Delete “${pendingDelete.label}”?`');
    expect(success.indexOf("setSelectedFieldId(null);")).toBeGreaterThan(success.indexOf("await requestData"));
    expect(success.indexOf("setPendingDelete(null);")).toBeGreaterThan(success.indexOf("await requestData"));
    expect(success.slice(success.indexOf("catch"))).not.toContain("setPendingDelete(null)");
  });

  it("rejects whitespace-only metadata and question labels while normalizing valid values", () => {
    expect(validatePortalFormMetadata("  ", "Speaker update")).toEqual({ ok: false, message: "Internal form name is required" });
    expect(validatePortalFormMetadata("Profile", "  ")).toEqual({ ok: false, message: "Public title is required" });
    expect(validatePortalFormMetadata("  Profile  ", "  Speaker update  ")).toEqual({
      ok: true,
      internalName: "Profile",
      externalTitle: "Speaker update",
    });
    expect(normalizePortalFieldLabel("   ")).toBeNull();
    expect(normalizePortalFieldLabel("  Dietary needs  ")).toBe("Dietary needs");
  });
});
