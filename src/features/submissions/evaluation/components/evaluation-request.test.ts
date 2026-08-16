import { describe, expect, it, vi } from "vitest";
import { evaluationFailureMessage, evaluationRequest } from "./evaluation-request";
import { completePlanAndReviewerSave } from "./plan-editor";
import { normalizeReviewerEmail } from "./reviewer-invite-dialog";

describe("evaluationRequest", () => {
  it("preserves HTTP errors and normalizes transport and malformed responses", async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ error: { code: "CONFLICT", message: "Round is closed" } }), { status: 409 }));
    const offline = vi.fn(async () => { throw new TypeError("offline"); });
    const malformed = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));

    await expect(evaluationRequest("/evaluation", { method: "PUT" }, "Could not save", refused)).resolves.toEqual({
      ok: false,
      kind: "response",
      message: "Round is closed",
      code: "CONFLICT",
    });
    await expect(evaluationRequest("/evaluation", { method: "PUT" }, "Could not save", offline)).resolves.toEqual({ ok: false, kind: "transport", message: "Could not save" });
    await expect(evaluationRequest("/evaluation", { method: "PUT" }, "Could not save", malformed)).resolves.toEqual({
      ok: false,
      kind: "response",
      message: "Could not save",
    });
  });

  it("returns parsed data only for a successful response", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ data: { assigned: 2 } }), { status: 200 }));
    await expect(evaluationRequest<{ assigned: number }>("/evaluation", { method: "PUT" }, "Could not save", request)).resolves.toEqual({ ok: true, data: { assigned: 2 } });
  });

  it("adds connection recovery guidance only to transport failures", () => {
    expect(evaluationFailureMessage({ kind: "response", message: "Round is closed" })).toBe("Round is closed");
    expect(evaluationFailureMessage({ kind: "transport", message: "Could not save" })).toBe("Could not save — check your connection and try again");
  });
});

describe("reviewer invitation validation", () => {
  it("rejects incomplete addresses and normalizes valid email before submission", () => {
    expect(normalizeReviewerEmail("not-an-email")).toBeNull();
    expect(normalizeReviewerEmail("  REVIEWER@Example.com ")).toBe("reviewer@example.com");
  });
});

describe("round and reviewer save recovery", () => {
  it("retries only reviewer assignment after the round has already saved", async () => {
    const savePlan = vi.fn(async () => ({ ok: true as const, data: { planId: "plan-1" } }));
    const saveReviewers = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, kind: "response" as const, message: "Reviewers unavailable" })
      .mockResolvedValueOnce({ ok: true as const, data: { plan: { id: "plan-1" } } });

    const first = await completePlanAndReviewerSave(null, savePlan, saveReviewers);
    expect(first).toEqual({ ok: false, kind: "response", message: "Reviewers unavailable", pendingReviewerPlanId: "plan-1" });

    const retry = await completePlanAndReviewerSave("plan-1", savePlan, saveReviewers);
    // A retry skips the round write, so the reviewer response is the only one
    // that can report the round back — and it does.
    expect(retry).toEqual({ ok: true, planId: "plan-1", plan: { id: "plan-1" } });
    expect(savePlan).toHaveBeenCalledOnce();
    expect(saveReviewers).toHaveBeenCalledTimes(2);
    expect(saveReviewers).toHaveBeenLastCalledWith("plan-1");
  });

  it("preserves transport failure kind through the two-stage save controller", async () => {
    const savePlan = vi.fn(async () => ({ ok: false as const, kind: "transport" as const, message: "That round did not save" }));
    const saveReviewers = vi.fn();

    await expect(completePlanAndReviewerSave(null, savePlan, saveReviewers)).resolves.toEqual({
      ok: false,
      kind: "transport",
      message: "That round did not save",
      pendingReviewerPlanId: null,
    });
    expect(saveReviewers).not.toHaveBeenCalled();
  });

  it("replays a stable-id plan create after its committed response is lost, then saves reviewers", async () => {
    const stablePlanId = "b2000000-0000-4000-8000-000000000097";
    let committed = false;
    const savePlan = vi.fn(async () => {
      if (!committed) {
        committed = true;
        return { ok: false as const, kind: "transport" as const, message: "That round did not save" };
      }
      return { ok: true as const, data: { planId: stablePlanId } };
    });
    const saveReviewers = vi.fn(async () => ({ ok: true as const, data: {} }));

    await expect(completePlanAndReviewerSave(null, savePlan, saveReviewers)).resolves.toMatchObject({ ok: false, kind: "transport" });
    // Neither write was in a position to report the round: the replayed create
    // answered with an id alone, and reviewers were unchanged. Null says so
    // rather than inventing one.
    await expect(completePlanAndReviewerSave(null, savePlan, saveReviewers)).resolves.toEqual({ ok: true, planId: stablePlanId, plan: null });
    expect(savePlan).toHaveBeenCalledTimes(2);
    expect(saveReviewers).toHaveBeenCalledOnce();
    expect(saveReviewers).toHaveBeenCalledWith(stablePlanId);
  });
});
