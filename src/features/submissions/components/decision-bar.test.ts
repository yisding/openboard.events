import { describe, expect, it, vi } from "vitest";
import { submissionIdSchema, type SubmissionStatus } from "@/shared/contracts";
import { completeBulkDecision } from "./decision-bar";

const ids = {
  pending: submissionIdSchema.parse("e5000000-0000-4000-8000-000000000001"),
  draft: submissionIdSchema.parse("e5000000-0000-4000-8000-000000000002"),
};

function response(data: { changed: string[]; stale: string[] }): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function serverError(message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
}

function selection() {
  return [
    { submissionId: ids.pending, status: "pending" as SubmissionStatus },
    { submissionId: ids.draft, status: "draft" as SubmissionStatus },
  ];
}

function effects() {
  return { toast: vi.fn(), onDone: vi.fn(), refresh: vi.fn() };
}

describe("completeBulkDecision", () => {
  it("refreshes and clears stale selection after an early success followed by a 5xx", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({ changed: [ids.pending], stale: [] }))
      .mockResolvedValueOnce(serverError("Transition service unavailable"));
    const sideEffects = effects();

    const outcome = await completeBulkDecision({
      eventId: "event-1",
      selected: selection(),
      to: "accept_queue",
      effects: sideEffects,
      request,
    });

    expect(outcome).toMatchObject({ moved: 1, unchanged: 0, unconfirmed: 1, confirmedGroups: 1, failedGroups: 1 });
    expect(sideEffects.toast).toHaveBeenCalledWith(
      "1 moved · 1 could not be confirmed. The list was refreshed; reselect anything still pending and retry.",
      { kind: "error" },
    );
    expect(sideEffects.onDone).toHaveBeenCalledOnce();
    expect(sideEffects.refresh).toHaveBeenCalledOnce();
  });

  it("refreshes and clears stale selection after an early success followed by a network failure", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({ changed: [ids.pending], stale: [] }))
      .mockRejectedValueOnce(new Error("connection lost"));
    const sideEffects = effects();

    const outcome = await completeBulkDecision({
      eventId: "event-1",
      selected: selection(),
      to: "decline_queue",
      effects: sideEffects,
      request,
    });

    expect(outcome).toMatchObject({ moved: 1, unconfirmed: 1, confirmedGroups: 1, failedGroups: 1 });
    expect(outcome.failureMessages).toEqual(["Could not reach the server"]);
    expect(sideEffects.onDone).toHaveBeenCalledOnce();
    expect(sideEffects.refresh).toHaveBeenCalledOnce();
  });

  it("keeps the selection when no transition can be confirmed", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(serverError("Transition service unavailable"))
      .mockRejectedValueOnce(new Error("connection lost"));
    const sideEffects = effects();

    const outcome = await completeBulkDecision({
      eventId: "event-1",
      selected: selection(),
      to: "accept_queue",
      effects: sideEffects,
      request,
    });

    expect(outcome).toMatchObject({ moved: 0, unchanged: 0, unconfirmed: 2, confirmedGroups: 0, failedGroups: 2 });
    expect(sideEffects.toast).toHaveBeenCalledWith(
      "2 could not be confirmed. Transition service unavailable. Keep this selection and retry; already-applied transitions are safe to retry.",
      { kind: "error" },
    );
    expect(sideEffects.onDone).not.toHaveBeenCalled();
    expect(sideEffects.refresh).not.toHaveBeenCalled();
  });

  it("preserves the full-success toast and refresh behavior", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({ changed: [ids.pending], stale: [] }))
      .mockResolvedValueOnce(response({ changed: [], stale: [ids.draft] }));
    const sideEffects = effects();

    const outcome = await completeBulkDecision({
      eventId: "event-1",
      selected: selection(),
      to: "accept_queue",
      effects: sideEffects,
      request,
    });

    expect(outcome).toMatchObject({ moved: 1, unchanged: 1, unconfirmed: 0, confirmedGroups: 2, failedGroups: 0 });
    expect(sideEffects.toast).toHaveBeenCalledWith("1 moved · 1 unchanged, someone else had already moved them");
    expect(sideEffects.onDone).toHaveBeenCalledOnce();
    expect(sideEffects.refresh).toHaveBeenCalledOnce();
  });
});
