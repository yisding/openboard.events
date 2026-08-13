import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { submissionIdSchema, type SubmissionStatus } from "@/shared/contracts";
import { completeBulkDecision, DecisionEmailPreflight } from "./decision-bar";

Object.assign(globalThis, { React });

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

function conflict(message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status: 409,
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

    expect(outcome).toMatchObject({ moved: 1, unchanged: 0, rejected: 0, unconfirmed: 1, confirmedGroups: 1, unconfirmedGroups: 1 });
    expect(sideEffects.toast).toHaveBeenCalledWith(
      "1 moved · 1 could not be confirmed. The list was refreshed; reselect anything still pending and retry.",
      { kind: "error" },
    );
    expect(sideEffects.onDone).toHaveBeenCalledOnce();
    expect(sideEffects.refresh).toHaveBeenCalledOnce();
  });

  it("surfaces a deterministic 409 reason after success without advising a futile retry", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({ changed: [ids.pending], stale: [] }))
      .mockResolvedValueOnce(conflict("Cannot transition draft to accept queue"));
    const sideEffects = effects();

    const outcome = await completeBulkDecision({
      eventId: "event-1",
      selected: selection(),
      to: "accept_queue",
      effects: sideEffects,
      request,
    });

    expect(outcome).toMatchObject({ moved: 1, rejected: 1, unconfirmed: 0, confirmedGroups: 1, rejectedGroups: 1 });
    expect(outcome.rejectionMessages).toEqual(["Cannot transition draft to accept queue"]);
    expect(sideEffects.toast).toHaveBeenCalledWith(
      "1 moved · 1 rejected: Cannot transition draft to accept queue. The list was refreshed; address the rejection before acting on those rows.",
      { kind: "error" },
    );
    expect(sideEffects.toast.mock.calls[0]?.[0]).not.toContain("retry");
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

    expect(outcome).toMatchObject({ moved: 1, rejected: 0, unconfirmed: 1, confirmedGroups: 1, unconfirmedGroups: 1 });
    expect(outcome.unconfirmedMessages).toEqual(["Could not reach the server"]);
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

    expect(outcome).toMatchObject({ moved: 0, unchanged: 0, rejected: 0, unconfirmed: 2, confirmedGroups: 0, unconfirmedGroups: 2 });
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

    expect(outcome).toMatchObject({ moved: 1, unchanged: 1, rejected: 0, unconfirmed: 0, confirmedGroups: 2, rejectedGroups: 0, unconfirmedGroups: 0 });
    expect(sideEffects.toast).toHaveBeenCalledWith("1 moved · 1 unchanged, someone else had already moved them");
    expect(sideEffects.onDone).toHaveBeenCalledOnce();
    expect(sideEffects.refresh).toHaveBeenCalledOnce();
  });
});

describe("DecisionEmailPreflight", () => {
  it("shows exact counts, delivery gaps, and the current sample template", () => {
    const html = renderToStaticMarkup(React.createElement(DecisionEmailPreflight, {
      preview: {
        accepted: 2,
        declined: 1,
        emailsQueued: 2,
        skippedNoRecipient: 1,
        queueRevision: "accept_queue:one:0",
        samples: [{
          decision: "accepted",
          recipientName: "Ada Lovelace",
          recipientEmail: "ada@example.com",
          submissionTitle: "Practical Engines",
          subject: "You are accepted",
          bodyHtml: "<p>Welcome, Ada.</p>",
          templateEnabled: false,
        }],
      },
      error: "",
      loading: false,
      onRetry: () => undefined,
    }));

    expect(html).toContain("3 queued decisions");
    expect(html).toContain("2 accepted · 1 declined · 2 emails");
    expect(html).toContain("1 submission has no recipient");
    expect(html).toContain("This template is paused");
    expect(html).toContain("You are accepted");
    expect(html).toContain("Links shown in samples are placeholders");
  });
});
