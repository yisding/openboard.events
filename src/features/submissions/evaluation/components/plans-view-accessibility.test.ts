import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("evaluation plan failure recovery", () => {
  it("keeps deletion confirmation open until DELETE succeeds", () => {
    const source = readFileSync(new URL("./plans-view.tsx", import.meta.url), "utf8");

    expect(source).toContain("async function remove(plan: PlanDTO): Promise<boolean>");
    expect(source).toContain("if (await remove(pendingDelete)) setPendingDelete(null);");
    expect(source).toContain('toast(payload?.error?.message ?? "That round could not be deleted", { kind: "error" });');
    expect(source).toContain('toast("That round could not be deleted", { kind: "error" });');
    expect(source).toContain('toast("Those reminders did not send", { kind: "error" });');
  });
});
