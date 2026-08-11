import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
});
