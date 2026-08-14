/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanDTO } from "../types";
import { PlansView } from "./plans-view";

const routerMock = vi.hoisted(() => ({ refresh: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const EVENT_ID = "c4200000-0000-4000-8000-000000000001";
const ATTEMPT_A = "c4200000-0000-4000-8003-000000000001" as `${string}-${string}-${string}-${string}-${string}`;
const ATTEMPT_B = "c4200000-0000-4000-8003-000000000002" as `${string}-${string}-${string}-${string}-${string}`;

function plan(suffix: string, name: string): PlanDTO {
  return {
    id: `c4200000-0000-4000-8000-${suffix}` as PlanDTO["id"],
    name,
    round: 1,
    scaleMin: 1,
    scaleMax: 5,
    status: "open",
    trackIds: null,
    opensAt: null,
    closesAt: null,
    anonymizeAuthors: false,
    showPeerScores: false,
    criteria: [],
    reviewers: [],
    progress: { scored: 0, total: 2 },
    updatedAt: "2026-08-13T12:00:00.000Z",
  };
}

const PLAN_A = plan("000000000010", "Round A");
const PLAN_B = plan("000000000020", "Round B");
const CLOSED_PLAN = { ...plan("000000000030", "Closed round"), status: "closed" as const };
const EXPIRED_PLAN = { ...plan("000000000040", "Expired round"), closesAt: "2000-01-01T00:00:00.000Z" };
const ADA = {
  reviewerUserId: "c4200000-0000-4000-8001-000000000011",
  name: "Ada Lovelace",
  email: "ada@example.com",
  outstanding: 2,
};
const GRACE = {
  reviewerUserId: "c4200000-0000-4000-8001-000000000012",
  name: "Grace Hopper",
  email: "grace@example.com",
  outstanding: 1,
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

async function settle() {
  await act(async () => {
    for (let step = 0; step < 5; step += 1) await Promise.resolve();
  });
}

async function renderPlans(plans: PlanDTO[] = [PLAN_A]) {
  await act(async () => {
    root.render(
      <PlansView
        eventId={EVENT_ID}
        plans={plans}
        tracks={[]}
        members={[]}
        pendingReviewerInvitations={[]}
        timezone="America/Los_Angeles"
      />,
    );
  });
  await settle();
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function rowButton(round: string, name: string): HTMLButtonElement | undefined {
  const row = [...container.querySelectorAll<HTMLTableRowElement>("tbody tr")]
    .find((candidate) => candidate.textContent?.includes(round));
  return [...(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .find((button) => button.textContent?.trim() === name);
}

function editorStatusSelect(): HTMLSelectElement | undefined {
  return [...container.querySelectorAll<HTMLSelectElement>("select")]
    .find((select) => [...select.options].some((option) => option.textContent?.includes("scores are final")));
}

beforeEach(() => {
  routerMock.refresh.mockReset();
  toastMock.mockReset();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const attemptIds = [ATTEMPT_A, ATTEMPT_B];
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => attemptIds.shift() ?? ATTEMPT_B);
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  if (typeof HTMLDialogElement.prototype.showModal !== "function") {
    HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  }
  if (typeof HTMLDialogElement.prototype.close !== "function") {
    HTMLDialogElement.prototype.close = function close() { this.open = false; };
  }
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("evaluation reminder exact-recipient preflight", () => {
  it("keeps assignment entry points closed with specific recovery guidance", async () => {
    await renderPlans([CLOSED_PLAN, EXPIRED_PLAN, PLAN_A]);

    expect(rowButton("Closed round", "Assign")?.disabled).toBe(true);
    expect(rowButton("Closed round", "Assign")?.closest("tr")?.textContent).toContain("Reopen to assign");
    expect(rowButton("Expired round", "Assign")?.disabled).toBe(true);
    expect(rowButton("Expired round", "Assign")?.closest("tr")?.textContent).toContain("Extend to assign");
    expect(rowButton("Round A", "Assign")?.disabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps an open assignment drawer synchronized with refreshed round props", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: { submissions: [] } }));
    await renderPlans([PLAN_A]);
    await act(async () => rowButton("Round A", "Assign")?.click());
    await settle();

    expect(container.textContent).toContain("Assign work · Round A");
    await renderPlans([{ ...PLAN_A, status: "closed" }]);

    expect(container.textContent).toContain("Assignments are locked. Reopen this round before changing reviewer assignments.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("derives an open editor's assignment lock from refreshed close and extend props", async () => {
    await renderPlans([PLAN_A]);
    await act(async () => rowButton("Round A", "Edit")?.click());
    await settle();
    expect(container.textContent).toContain("Edit Round A");
    expect(container.textContent).not.toContain("Track and reviewer assignments are locked.");

    await renderPlans([{ ...PLAN_A, status: "closed", updatedAt: "2026-08-13T13:00:00.000Z" }]);
    expect(container.textContent).toContain("Track and reviewer assignments are locked. Reopen this round before changing reviewer assignments.");
    expect(editorStatusSelect()?.value).toBe("closed");

    await renderPlans([{ ...PLAN_A, status: "open", updatedAt: "2026-08-13T14:00:00.000Z" }]);
    expect(container.textContent).toContain("Edit Round A");
    expect(container.textContent).not.toContain("Track and reviewer assignments are locked.");
    expect(editorStatusSelect()?.value).toBe("open");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locks the assignment entry point when its deadline passes on screen", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    const timedPlan = { ...PLAN_A, closesAt: "2026-08-14T12:00:01.000Z" };
    await renderPlans([timedPlan]);

    expect(rowButton("Round A", "Assign")?.disabled).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1_100);
      await Promise.resolve();
    });
    await settle();

    expect(rowButton("Round A", "Assign")?.disabled).toBe(true);
    expect(rowButton("Round A", "Assign")?.closest("tr")?.textContent).toContain("Extend to assign");
  });

  it("previews exact recipients before one explicit, double-click-safe send", async () => {
    let resolvePreview!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolvePreview = resolve; }));
    await renderPlans();

    await act(async () => rowButton("Round A", "Remind")?.click());

    expect(container.textContent).toContain("Checking who still has reviews to finish…");
    expect(buttonNamed("Send reminders")?.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(`/api/internal/evaluation/${EVENT_ID}/plans/${PLAN_A.id}/reminders`);

    resolvePreview(Response.json({ data: { reviewers: [ADA, GRACE] } }));
    await settle();

    expect(container.textContent).toContain("2 reviewers will be reminded");
    expect(container.textContent).toContain("Ada Lovelace · ada@example.com");
    expect(container.textContent).toContain("2 outstanding proposals");
    expect(container.textContent).toContain("Grace Hopper · grace@example.com");
    expect(container.textContent).toContain("1 outstanding proposal");
    expect(buttonNamed("Send reminders")?.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledOnce();

    let resolveSend!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveSend = resolve; }));
    const confirm = buttonNamed("Send reminders");
    await act(async () => confirm?.click());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/internal/evaluation/${EVENT_ID}/plans/${PLAN_A.id}/reminders`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reviewerUserIds: [ADA.reviewerUserId, GRACE.reviewerUserId], attemptId: ATTEMPT_A }),
    });
    expect(buttonNamed("Working…")?.disabled).toBe(true);
    await act(async () => confirm?.click());
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveSend(Response.json({ data: { enqueued: 2, skipped: 0 } }));
    await settle();

    expect(container.textContent).not.toContain("Remind reviewers for Round A?");
    expect(toastMock).toHaveBeenCalledWith("Reminded 2 reviewers");
    expect(routerMock.refresh).toHaveBeenCalledOnce();
  });

  it("retries preview failures in place and cannot send an empty audience", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await renderPlans();
    await act(async () => rowButton("Round A", "Remind")?.click());
    await settle();

    expect(container.textContent).toContain("Could not reach the server to preview these reminders");
    expect(buttonNamed("Retry preview")).toBeDefined();
    expect(buttonNamed("Send reminders")?.disabled).toBe(true);

    fetchMock.mockResolvedValueOnce(Response.json({ data: { reviewers: [] } }));
    await act(async () => buttonNamed("Retry preview")?.click());
    await settle();

    expect(container.textContent).toContain("Nobody on this round has outstanding work.");
    expect(buttonNamed("Send reminders")?.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init === undefined)).toBe(true);
  });

  it("keeps a refused send recoverable with the server's message", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: { reviewers: [ADA] } }))
      .mockResolvedValueOnce(Response.json({ error: { code: "CONFLICT", message: "Reminders only go out while the round is open" } }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ data: { enqueued: 1, skipped: 0 } }));
    await renderPlans();
    await act(async () => rowButton("Round A", "Remind")?.click());
    await settle();

    await act(async () => buttonNamed("Send reminders")?.click());
    await settle();

    expect(container.textContent).toContain("Reminders only go out while the round is open");
    expect(container.textContent).toContain("Ada Lovelace · ada@example.com");
    expect(buttonNamed("Send reminders")?.disabled).toBe(false);
    expect(routerMock.refresh).not.toHaveBeenCalled();

    await act(async () => buttonNamed("Send reminders")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(toastMock).toHaveBeenCalledWith("Reminded 1 reviewer");
    expect(routerMock.refresh).toHaveBeenCalledOnce();
  });

  it("retries an unconfirmed POST with the same attempt without reloading the preview", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: { reviewers: [ADA] } }))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(Response.json({ data: { enqueued: 1, skipped: 0 } }));
    await renderPlans();
    await act(async () => rowButton("Round A", "Remind")?.click());
    await settle();

    await act(async () => buttonNamed("Send reminders")?.click());
    await settle();

    expect(container.textContent).toContain("These reminders were not confirmed; check Communications before retrying.");
    expect(container.textContent).toContain("Ada Lovelace · ada@example.com");
    expect(buttonNamed("Send reminders")?.disabled).toBe(false);

    await act(async () => buttonNamed("Send reminders")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([, init]) => init === undefined)).toHaveLength(1);
    const firstAttempt = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { reviewerUserIds: string[]; attemptId: string };
    const retriedAttempt = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as { reviewerUserIds: string[]; attemptId: string };
    expect(firstAttempt).toEqual({ reviewerUserIds: [ADA.reviewerUserId], attemptId: ATTEMPT_A });
    expect(retriedAttempt).toEqual(firstAttempt);
    expect(toastMock).toHaveBeenCalledWith("Reminded 1 reviewer");
  });

  it("ignores a late preview after switching the dialog to another round", async () => {
    let resolveRoundA!: (response: Response) => void;
    fetchMock
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRoundA = resolve; }))
      .mockResolvedValueOnce(Response.json({ data: { reviewers: [GRACE] } }))
      .mockResolvedValueOnce(Response.json({ data: { enqueued: 1, skipped: 0 } }));
    await renderPlans([PLAN_A, PLAN_B]);

    await act(async () => rowButton("Round A", "Remind")?.click());
    await act(async () => rowButton("Round B", "Remind")?.click());
    await settle();

    expect(container.textContent).toContain("Remind reviewers for Round B?");
    expect(container.textContent).toContain("Grace Hopper · grace@example.com");

    resolveRoundA(Response.json({ data: { reviewers: [ADA] } }));
    await settle();

    expect(container.textContent).toContain("Grace Hopper · grace@example.com");
    expect(container.textContent).not.toContain("Ada Lovelace · ada@example.com");

    await act(async () => buttonNamed("Send reminders")?.click());
    await settle();
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/internal/evaluation/${EVENT_ID}/plans/${PLAN_B.id}/reminders`, expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(String(fetchMock.mock.lastCall?.[1]?.body)) as { reviewerUserIds: string[]; attemptId: string };
    expect(body).toEqual({ reviewerUserIds: [GRACE.reviewerUserId], attemptId: ATTEMPT_B });
  });
});
