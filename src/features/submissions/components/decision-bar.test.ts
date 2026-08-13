import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { submissionIdSchema, type SubmissionListRow, type SubmissionStatus } from "@/shared/contracts";
import { BULK_DECISION_LIMIT } from "../bulk-decision-limit";
import { completeBulkDecision, DecisionBar, DecisionEmailPreflight } from "./decision-bar";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toast: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/shared/ui/toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

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

  it("keeps an expanded 200-row scope after an unconfirmed request and sends its observed status", async () => {
    const selected = Array.from({ length: BULK_DECISION_LIMIT }, (_, index) => ({
      submissionId: submissionIdSchema.parse(`e5000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`),
      status: "pending" as const,
    }));
    const request = vi.fn().mockResolvedValue(serverError("Transition service unavailable"));
    const sideEffects = effects();

    const outcome = await completeBulkDecision({
      eventId: "event-1",
      selected,
      to: "accept_queue",
      effects: sideEffects,
      request,
    });

    const sent = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as { ids: string[]; expectedFrom: string };
    expect(sent.ids).toHaveLength(BULK_DECISION_LIMIT);
    expect(sent.expectedFrom).toBe("pending");
    expect(outcome).toMatchObject({ moved: 0, unconfirmed: BULK_DECISION_LIMIT, confirmedGroups: 0 });
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

describe("DecisionBar selection scope", () => {
  it("renders a keyboard-operable escalation for the bounded matching set", () => {
    const selected = [{ submissionId: ids.pending }] as SubmissionListRow[];
    const html = renderToStaticMarkup(React.createElement(DecisionBar, {
      eventId: "event-1",
      selected,
      pendingNotify: 0,
      countLabel: "1 abstract selected on this page",
      selectAllMatching: { count: 87, busy: false, request: () => undefined },
      onDone: () => undefined,
    }));

    expect(html).toContain("Select all 87 matching abstracts");
    expect(html).toContain('type="button"');
    expect(html).not.toContain('role="status"');
  });

  it("disables repeated expansion requests while the authoritative page is loading", () => {
    const selected = [{ submissionId: ids.pending }] as SubmissionListRow[];
    const html = renderToStaticMarkup(React.createElement(DecisionBar, {
      eventId: "event-1",
      selected,
      pendingNotify: 0,
      countLabel: "1 abstract selected on this page",
      selectAllMatching: { count: 87, busy: true, request: () => undefined },
      onDone: () => undefined,
    }));

    expect(html).toContain("Selecting all 87…");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Selecting all 87…<\/button>/u);
  });

  it("announces the final matching scope without leaving an obsolete escalation", () => {
    const selected = [{ submissionId: ids.pending }] as SubmissionListRow[];
    const html = renderToStaticMarkup(React.createElement(DecisionBar, {
      eventId: "event-1",
      selected,
      pendingNotify: 0,
      countLabel: "1 matching abstract selected",
      allMatching: true,
      onDone: () => undefined,
    }));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain("1 matching abstract selected");
    expect(html).not.toContain("Select all");
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
