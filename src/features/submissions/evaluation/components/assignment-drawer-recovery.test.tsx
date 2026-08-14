/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignableSubmission, PlanDTO } from "../types";
import { AssignmentDrawer } from "./assignment-drawer";

const routerMock = vi.hoisted(() => ({ refresh: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: vi.fn(),
  useGuardedAction: () => ({ runGuarded: (action: () => void) => action() }),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const EVENT_ID = "c4200000-0000-4000-8000-000000000001";

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
    reviewers: [{
      userId: `c4200000-0000-4000-8001-${suffix}` as PlanDTO["reviewers"][number]["userId"],
      name: `${name} reviewer`,
      email: `${name.toLowerCase().replaceAll(" ", "-")}@example.com`,
      trackIds: null,
      assigned: 0,
      completed: 0,
      recused: 0,
      outstanding: 0,
      scored: 0,
    }],
    progress: { scored: 0, total: 1 },
    updatedAt: "2026-08-13T12:00:00.000Z",
  };
}

function submission(suffix: string, title: string): AssignableSubmission {
  return {
    submissionId: `c4200000-0000-4000-8002-${suffix}` as AssignableSubmission["submissionId"],
    code: Number(suffix.slice(-2)),
    title,
    trackId: null,
    trackName: null,
    assignedTo: [],
  };
}

const PLAN_A = plan("000000000010", "Round A");
const PLAN_B = plan("000000000020", "Round B");
const CLOSED_PLAN = { ...plan("000000000030", "Closed round"), status: "closed" as const };
const EXPIRED_PLAN = { ...plan("000000000040", "Expired round"), closesAt: "2000-01-01T00:00:00.000Z" };
const SUBMISSION_A = submission("000000000011", "Proposal from round A");
const SUBMISSION_B = submission("000000000021", "Proposal from round B");

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

async function settle() {
  await act(async () => {
    for (let step = 0; step < 5; step += 1) await Promise.resolve();
  });
}

async function renderDrawer(currentPlan: PlanDTO) {
  await act(async () => {
    root.render(<AssignmentDrawer eventId={EVENT_ID} plan={currentPlan} onClose={vi.fn()} />);
  });
  await settle();
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function reviewerCheckbox(name: string): HTMLInputElement | undefined {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .find((input) => input.parentElement?.textContent?.includes(name));
}

beforeEach(() => {
  routerMock.refresh.mockReset();
  toastMock.mockReset();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
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
});

describe("evaluation assignment drawer loading recovery", () => {
  it.each([
    [CLOSED_PLAN, "Reopen this round before changing reviewer assignments."],
    [EXPIRED_PLAN, "Extend this round’s close date before changing reviewer assignments."],
  ])("does not load or unlock a terminal round", async (lockedPlan, guidance) => {
    await renderDrawer(lockedPlan);

    expect(container.textContent).toContain(`Assignments are locked. ${guidance}`);
    expect(reviewerCheckbox(`${lockedPlan.name} reviewer`)?.matches(":disabled")).toBe(true);
    expect(buttonNamed("Assign 0")?.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables an already-loaded assignment draft as soon as the round closes", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: { submissions: [SUBMISSION_A] } }));
    await renderDrawer(PLAN_A);

    await act(async () => reviewerCheckbox("Round A reviewer")?.click());
    await act(async () => buttonNamed("Select all shown")?.click());
    expect(buttonNamed("Assign 1")?.disabled).toBe(false);

    await renderDrawer({ ...PLAN_A, status: "closed" });

    expect(container.textContent).toContain("Assignments are locked. Reopen this round before changing reviewer assignments.");
    expect(reviewerCheckbox("Round A reviewer")?.checked).toBe(true);
    expect(reviewerCheckbox("Round A reviewer")?.disabled).toBe(true);
    expect(buttonNamed("Assign 1")?.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reloads candidates for a refreshed scope and keeps only still-eligible selections", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: { submissions: [SUBMISSION_A, SUBMISSION_B] } }));
    await renderDrawer(PLAN_A);
    await act(async () => reviewerCheckbox("Round A reviewer")?.click());
    await act(async () => buttonNamed("Select all shown")?.click());
    expect(buttonNamed("Assign 2")?.disabled).toBe(false);

    let resolveRefresh!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRefresh = resolve; }));
    await renderDrawer({
      ...PLAN_A,
      trackIds: ["c4200000-0000-4000-8004-000000000099" as NonNullable<PlanDTO["trackIds"]>[number]],
      updatedAt: "2026-08-13T13:00:00.000Z",
    });

    expect(container.textContent).toContain("Loading this round’s submissions…");
    expect(buttonNamed("Assign 2")?.disabled).toBe(true);

    resolveRefresh(Response.json({ data: { submissions: [SUBMISSION_B] } }));
    await settle();

    expect(container.textContent).not.toContain(SUBMISSION_A.title);
    expect(container.textContent).toContain(SUBMISSION_B.title);
    expect(container.textContent).toContain("1 submission selected from 1 shown.");
    expect(buttonNamed("Assign 1")?.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("locks an open drawer at its close deadline without waiting for another render", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    const timedPlan = { ...PLAN_A, closesAt: "2026-08-14T12:00:01.000Z" };
    fetchMock.mockResolvedValueOnce(Response.json({ data: { submissions: [SUBMISSION_A] } }));
    await renderDrawer(timedPlan);

    await act(async () => reviewerCheckbox("Round A reviewer")?.click());
    await act(async () => buttonNamed("Select all shown")?.click());
    expect(buttonNamed("Assign 1")?.disabled).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(1_100);
      await Promise.resolve();
    });
    await settle();

    expect(container.textContent).toContain("Assignments are locked. Extend this round’s close date before changing reviewer assignments.");
    expect(reviewerCheckbox("Round A reviewer")?.disabled).toBe(true);
    expect(buttonNamed("Assign 1")?.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers a transport failure in place and unlocks the loaded round", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await renderDrawer(PLAN_A);

    expect(container.textContent).toContain("Check your connection and try again");
    expect(reviewerCheckbox("Round A reviewer")?.disabled).toBe(true);
    expect(buttonNamed("Retry loading submissions")).toBeDefined();

    let resolveRetry!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRetry = resolve; }));
    await act(async () => buttonNamed("Retry loading submissions")?.click());

    expect(container.textContent).toContain("Retrying this round’s submissions…");
    expect(buttonNamed("Retry loading submissions")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resolveRetry(Response.json({ data: { submissions: [SUBMISSION_A] } }));
    await settle();

    expect(container.textContent).toContain(SUBMISSION_A.title);
    expect(reviewerCheckbox("Round A reviewer")?.disabled).toBe(false);
    expect(buttonNamed("Select all shown")?.disabled).toBe(false);
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/internal/evaluation/${EVENT_ID}/plans/${PLAN_A.id}/assignments`);
  });

  it.each([
    [401, "UNAUTHORIZED", "Sign in required"],
    [403, "FORBIDDEN", "You do not have access to this event"],
    [404, "NOT_FOUND", "Evaluation plan not found"],
  ])("keeps %s %s authoritative instead of presenting connection recovery", async (status, code, message) => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code, message } }, { status }));
    await renderDrawer(PLAN_A);

    expect(container.textContent).toContain(message);
    expect(container.textContent).not.toContain("Check your connection");
    expect(buttonNamed("Retry loading submissions")).toBeUndefined();
    expect(reviewerCheckbox("Round A reviewer")?.disabled).toBe(true);
  });

  it("keeps a transient server response retryable without calling it a connection failure", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: "INTERNAL", message: "Unexpected server error" } }, { status: 503 }));
    await renderDrawer(PLAN_A);

    expect(container.textContent).toContain("Unexpected server error");
    expect(container.textContent).not.toContain("Check your connection");
    expect(buttonNamed("Retry loading submissions")).toBeDefined();
  });

  it("drops a late response after the drawer moves to another round", async () => {
    let resolveRoundA!: (response: Response) => void;
    fetchMock
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRoundA = resolve; }))
      .mockResolvedValueOnce(Response.json({ data: { submissions: [SUBMISSION_B] } }));

    await renderDrawer(PLAN_A);
    await renderDrawer(PLAN_B);
    expect(container.textContent).toContain(SUBMISSION_B.title);

    resolveRoundA(Response.json({ data: { submissions: [SUBMISSION_A] } }));
    await settle();

    expect(container.textContent).toContain(SUBMISSION_B.title);
    expect(container.textContent).not.toContain(SUBMISSION_A.title);
    expect(reviewerCheckbox("Round B reviewer")?.disabled).toBe(false);
  });
});
