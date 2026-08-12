import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canSubmitAssignments, keepShownAssignmentSelection, needsEmptyReplacementConfirmation } from "./assignment-drawer";

const ready = {
  loaded: true,
  hasLoadError: false,
  busy: false,
  reviewerCount: 1,
  selectedCount: 1,
  mode: "add" as const,
  currentAssignmentCount: 0,
};

describe("assignment drawer submission safety", () => {
  it("keeps assignment checkboxes compact inside full-row labels", () => {
    const css = readFileSync(new URL("../../../../app/globals.css", import.meta.url), "utf8");

    expect(css).toContain(".reviewer-assignment{display:grid;grid-template-columns:16px minmax(0,1fr)");
    expect(css).toContain("min-height:44px");
    expect(css).toContain('.reviewer-assignment input[type="checkbox"]{grid-column:1;grid-row:1/3;width:16px;height:16px;margin:0;padding:0');
  });

  it("never submits before candidates load or after loading fails", () => {
    expect(canSubmitAssignments({ ...ready, loaded: false })).toBe(false);
    expect(canSubmitAssignments({ ...ready, hasLoadError: true })).toBe(false);
  });

  it("requires reviewers and a submission when adding work", () => {
    expect(canSubmitAssignments({ ...ready, reviewerCount: 0 })).toBe(false);
    expect(canSubmitAssignments({ ...ready, selectedCount: 0 })).toBe(false);
    expect(canSubmitAssignments(ready)).toBe(true);
  });

  it("permits an intentional empty replacement only when there is work to remove", () => {
    const emptyReplace = {
      ...ready,
      selectedCount: 0,
      mode: "replace" as const,
      currentAssignmentCount: 3,
    };
    expect(canSubmitAssignments(emptyReplace)).toBe(true);
    expect(needsEmptyReplacementConfirmation(emptyReplace)).toBe(true);

    const noOpReplace = { ...emptyReplace, currentAssignmentCount: 0 };
    expect(canSubmitAssignments(noOpReplace)).toBe(false);
    expect(needsEmptyReplacementConfirmation(noOpReplace)).toBe(false);
  });

  it("does not warn when replacement keeps at least one submission", () => {
    expect(needsEmptyReplacementConfirmation({
      mode: "replace",
      selectedCount: 1,
      currentAssignmentCount: 3,
    })).toBe(false);
  });

  it("drops selected submissions that a new track filter hides", () => {
    expect(keepShownAssignmentSelection(
      ["platform-a", "agents-a"],
      ["platform-a", "platform-b"],
    )).toEqual(["platform-a"]);
    expect(keepShownAssignmentSelection(["platform-a"], ["agents-a"])).toEqual([]);
  });

  it("preserves only still-selected IDs when a filter widens", () => {
    expect(keepShownAssignmentSelection(
      ["platform-b", "platform-a"],
      ["platform-a", "platform-b", "agents-a"],
    )).toEqual(["platform-b", "platform-a"]);
    expect(keepShownAssignmentSelection(["platform-a"], [])).toEqual([]);
  });
});
