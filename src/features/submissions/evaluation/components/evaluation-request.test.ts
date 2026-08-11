import { describe, expect, it, vi } from "vitest";
import { evaluationRequest } from "./evaluation-request";
import { completePlanAndReviewerSave } from "./plan-editor";

describe("evaluationRequest", () => {
  it("preserves HTTP errors and normalizes transport and malformed responses", async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Round is closed" } }), { status: 409 }));
    const offline = vi.fn(async () => { throw new TypeError("offline"); });
    const malformed = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));

    await expect(evaluationRequest("/evaluation", { method: "PUT" }, "Could not save", refused)).resolves.toEqual({ ok: false, message: "Round is closed" });
    await expect(evaluationRequest("/evaluation", { method: "PUT" }, "Could not save", offline)).resolves.toEqual({ ok: false, message: "Could not save" });
    await expect(evaluationRequest("/evaluation", { method: "PUT" }, "Could not save", malformed)).resolves.toEqual({ ok: false, message: "Could not save" });
  });

  it("returns parsed data only for a successful response", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: { assigned: 2 } }), { status: 200 }));
    await expect(evaluationRequest<{ assigned: number }>("/evaluation", { method: "PUT" }, "Could not save", request)).resolves.toEqual({ ok: true, data: { assigned: 2 } });
  });
});

describe("round and reviewer save recovery", () => {
  it("retries only reviewer assignment after the round has already saved", async () => {
    const savePlan = vi.fn(async () => ({ ok: true as const, data: { planId: "plan-1" } }));
    const saveReviewers = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, message: "Reviewers unavailable" })
      .mockResolvedValueOnce({ ok: true as const, data: {} });

    const first = await completePlanAndReviewerSave(null, savePlan, saveReviewers);
    expect(first).toEqual({ ok: false, message: "Reviewers unavailable", pendingReviewerPlanId: "plan-1" });

    const retry = await completePlanAndReviewerSave("plan-1", savePlan, saveReviewers);
    expect(retry).toEqual({ ok: true, planId: "plan-1" });
    expect(savePlan).toHaveBeenCalledOnce();
    expect(saveReviewers).toHaveBeenCalledTimes(2);
    expect(saveReviewers).toHaveBeenLastCalledWith("plan-1");
  });
});
