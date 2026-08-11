import { describe, expect, it, vi } from "vitest";
import type { PlanDTO } from "../types";
import { completeEvaluationPlanDelete, deleteEvaluationPlan } from "./plans-view";

describe("evaluation plan failure recovery", () => {
  const plan = { id: "plan-1", name: "Round one" } as PlanDTO;

  it("returns failure for refused and unreachable deletes", async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Close this round instead" } }), { status: 409 }));
    const offline = vi.fn(async () => { throw new Error("offline"); });

    await expect(deleteEvaluationPlan("event-1", "plan-1", refused)).resolves.toEqual({ ok: false, message: "Close this round instead" });
    await expect(deleteEvaluationPlan("event-1", "plan-1", offline)).resolves.toEqual({ ok: false, message: "That round could not be deleted" });
  });

  it("returns success only after the DELETE succeeds", async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(deleteEvaluationPlan("event-1", "plan-1", request)).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith("/api/internal/evaluation/event-1/plans/plan-1", { method: "DELETE" });
  });

  it("keeps confirmation open on failure and refreshes and closes on success", async () => {
    const effects = {
      onError: vi.fn(),
      onDeleted: vi.fn(),
      refresh: vi.fn(),
      closeConfirmation: vi.fn(),
    };
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Close this round instead" } }), { status: 409 }));
    await expect(completeEvaluationPlanDelete("event-1", plan, effects, refused)).resolves.toBe(false);
    expect(effects.onError).toHaveBeenCalledWith("Close this round instead");
    expect(effects.refresh).not.toHaveBeenCalled();
    expect(effects.closeConfirmation).not.toHaveBeenCalled();

    const succeeds = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(completeEvaluationPlanDelete("event-1", plan, effects, succeeds)).resolves.toBe(true);
    expect(effects.onDeleted).toHaveBeenCalledOnce();
    expect(effects.refresh).toHaveBeenCalledOnce();
    expect(effects.closeConfirmation).toHaveBeenCalledOnce();
  });
});
