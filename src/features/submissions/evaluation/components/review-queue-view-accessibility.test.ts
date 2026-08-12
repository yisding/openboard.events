import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CriterionValues } from "@/shared/contracts";
import { isReviewDraftDirty } from "./review-queue-view";

describe("review queue request feedback", () => {
  it("reports both HTTP and transport failures as errors for saves and recusals", () => {
    const source = readFileSync(new URL("./review-queue-view.tsx", import.meta.url), "utf8");

    expect(source).toContain('"That score did not save", { kind: "error" }');
    expect(source).toContain('"Could not reach the server. Your review was not saved.", { kind: "error" }');
    expect(source).toContain('"That recusal did not save", { kind: "error" }');
    expect(source).toContain('"Could not reach the server. Your recusal was not saved.", { kind: "error" }');
  });

  it("routes proposal clicks, the next shortcut, and round changes through the unsaved-work guard", () => {
    const source = readFileSync(new URL("./review-queue-view.tsx", import.meta.url), "utf8");

    expect(source).toContain('onClick={() => requestOpen(row.submissionId)}');
    expect(source).toContain("if (next) requestOpen(next.submissionId);");
    expect(source).toContain("onChange={(event) => requestRound(event.target.value)}");
    expect(source).toContain("useUnsavedWorkGuard(hasUnsavedWork)");
    expect(source).toContain('<ConfirmDialog\n        open={pendingNavigation !== null}');
  });

  it("detects meaningful draft changes without depending on criterion key order", () => {
    const saved = {
      overall: 4,
      comment: "Promising",
      values: {
        quality: { kind: "numeric" as const, value: 4 },
        fit: { kind: "select" as const, optionId: "yes" },
      } as unknown as CriterionValues,
    };

    expect(isReviewDraftDirty({
      ...saved,
      values: {
        fit: { kind: "select", optionId: "yes" },
        quality: { kind: "numeric", value: 4 },
      } as unknown as CriterionValues,
    }, saved)).toBe(false);
    expect(isReviewDraftDirty({ ...saved, overall: 5 }, saved)).toBe(true);
    expect(isReviewDraftDirty({ ...saved, comment: "Needs work" }, saved)).toBe(true);
    expect(isReviewDraftDirty({
      ...saved,
      values: { ...saved.values, quality: { kind: "numeric", value: 5 } } as unknown as CriterionValues,
    }, saved)).toBe(true);
  });
});
