/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanDTO } from "../types";
import { PlanEditor } from "./plan-editor";
import { settle } from "@tests/support/react";

const routerMock = vi.hoisted(() => ({ refresh: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: vi.fn(),
  useGuardedAction: () => ({ runGuarded: (action: () => void) => action() }),
}));
vi.mock("@/shared/ui/app/datetime-picker", () => ({
  DateTimePicker: ({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) => (
    <input
      data-date-picker
      value={value ?? ""}
      onChange={(event) => onChange(event.currentTarget.value || null)}
    />
  ),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const EVENT_ID = "c4300000-0000-4000-8000-000000000001";
const PLAN_ID = "c4300000-0000-4000-8000-000000000010" as PlanDTO["id"];
const REVIEWER_ID = "c4300000-0000-4000-8001-000000000011" as PlanDTO["reviewers"][number]["userId"];
const SECOND_REVIEWER_ID = "c4300000-0000-4000-8001-000000000012";
const CRITERION_ID = "c4300000-0000-4000-8002-000000000013" as PlanDTO["criteria"][number]["id"];
const OPTION_ID = "recommend-stable";

function plan(status: PlanDTO["status"]): PlanDTO {
  return {
    id: PLAN_ID,
    name: "Final round",
    round: 1,
    scaleMin: 1,
    scaleMax: 5,
    status,
    trackIds: null,
    opensAt: null,
    closesAt: null,
    anonymizeAuthors: false,
    showPeerScores: false,
    criteria: [],
    reviewers: [{
      userId: REVIEWER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
      trackIds: null,
      assigned: 1,
      completed: 1,
      recused: 0,
      outstanding: 0,
      scored: 1,
    }],
    progress: { scored: 1, total: 1 },
    hasReviews: false,
    updatedAt: "2026-08-13T12:00:00.000Z",
  };
}

const MEMBERS = [
  { userId: REVIEWER_ID, name: "Ada Lovelace", email: "ada@example.com", role: "reviewer" },
  { userId: SECOND_REVIEWER_ID, name: "Grace Hopper", email: "grace@example.com", role: "reviewer" },
];

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let onClose: ReturnType<typeof vi.fn>;


async function renderEditor(currentPlan: PlanDTO) {
  await act(async () => {
    root.render(
      <PlanEditor
        eventId={EVENT_ID}
        plan={currentPlan}
        tracks={[]}
        members={MEMBERS}
        nextRound={2}
        timezone="America/Los_Angeles"
        onSaved={vi.fn()}
        onClose={onClose}
      />,
    );
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

function statusSelect(): HTMLSelectElement | undefined {
  return [...container.querySelectorAll<HTMLSelectElement>("select")]
    .find((select) => [...select.options].some((option) => option.textContent?.includes("scores are final")));
}

function roundNameInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[required]');
}

function closesAtInput(): HTMLInputElement | undefined {
  return [...container.querySelectorAll<HTMLInputElement>("[data-date-picker]")][1];
}

function changeInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function changeStatus(value: PlanDTO["status"]): Promise<void> {
  const status = statusSelect();
  await act(async () => {
    if (!status) return;
    status.value = value;
    status.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function changeClosesAt(value: string): Promise<void> {
  const closesAt = closesAtInput();
  await act(async () => {
    if (closesAt) changeInput(closesAt, value);
  });
}

beforeEach(() => {
  routerMock.refresh.mockReset();
  toastMock.mockReset();
  onClose = vi.fn();
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

describe("evaluation plan assignment locking", () => {
  it("locks assignment controls and skips an unchanged reviewer write for a closed round", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: { planId: PLAN_ID } }));
    await renderEditor(plan("closed"));

    expect(container.textContent).toContain("Track and reviewer assignments are locked. Reopen this round before changing reviewer assignments.");
    expect(reviewerCheckbox("Ada Lovelace")?.closest("fieldset")?.disabled).toBe(true);
    expect(reviewerCheckbox("Grace Hopper")?.closest("fieldset")?.disabled).toBe(true);

    await act(async () => buttonNamed("Save round")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(`/api/internal/evaluation/${EVENT_ID}/plans/${PLAN_ID}`, expect.objectContaining({ method: "PATCH" }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/reviewers"))).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
    expect(routerMock.refresh).toHaveBeenCalledOnce();
  });

  it("refuses to close while reviewer edits are still unsaved", async () => {
    await renderEditor(plan("open"));
    const grace = reviewerCheckbox("Grace Hopper");
    expect(grace?.matches(":disabled")).toBe(false);
    await act(async () => grace?.click());

    const status = statusSelect();
    expect(status?.value).toBe("open");
    await act(async () => {
      if (!status) return;
      status.value = "closed";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(status?.value).toBe("open");
    expect(toastMock).toHaveBeenCalledWith(
      "Save assignment changes while the round is open, then close it in a separate edit",
      { kind: "error" },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("locks reviewer controls when the close deadline passes while editing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    await renderEditor({ ...plan("open"), closesAt: "2026-08-14T12:00:01.000Z" });

    expect(reviewerCheckbox("Grace Hopper")?.closest("fieldset")?.disabled).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1_100);
      await Promise.resolve();
    });
    await settle();

    expect(container.textContent).toContain("Extend this round’s close date before changing reviewer assignments.");
    expect(reviewerCheckbox("Grace Hopper")?.closest("fieldset")?.disabled).toBe(true);
  });

  it("rebases the optimistic revision when refreshed closure props are deliberately reopened", async () => {
    const initial = plan("open");
    await renderEditor(initial);
    const name = roundNameInput();
    await act(async () => {
      if (!name) return;
      changeInput(name, "Local program edit");
    });

    const latest = {
      ...initial,
      status: "closed" as const,
      round: 2,
      updatedAt: "2026-08-13T13:00:00.000Z",
    };
    await renderEditor(latest);

    expect(roundNameInput()?.value).toBe("Local program edit");
    expect(statusSelect()?.value).toBe("closed");
    expect(container.textContent).toContain("Reopen this round before changing reviewer assignments.");

    const status = statusSelect();
    await act(async () => {
      if (!status) return;
      status.value = "open";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    fetchMock.mockResolvedValueOnce(Response.json({ data: { planId: PLAN_ID } }));
    await act(async () => buttonNamed("Save round")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "Local program edit",
      round: 2,
      status: "open",
      expectedUpdatedAt: latest.updatedAt,
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/reviewers"))).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps a locally edited assignment window through a newer authoritative refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    const initial = {
      ...plan("closed"),
      closesAt: "2026-08-14T11:00:00.000Z",
    };
    const localClose = "2026-08-15T12:00:00.000Z";
    await renderEditor(initial);

    await changeStatus("open");
    await changeClosesAt(localClose);
    expect(statusSelect()?.value).toBe("open");
    expect(closesAtInput()?.value).toBe(localClose);

    const latest = {
      ...initial,
      round: 2,
      updatedAt: "2026-08-14T12:01:00.000Z",
    };
    await renderEditor(latest);

    expect(statusSelect()?.value).toBe("open");
    expect(closesAtInput()?.value).toBe(localClose);
    fetchMock.mockResolvedValueOnce(Response.json({ data: { planId: PLAN_ID } }));
    await act(async () => buttonNamed("Save round")?.click());
    await settle();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      round: 2,
      status: "open",
      closesAt: localClose,
      expectedUpdatedAt: latest.updatedAt,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("offers load-latest recovery when an ambiguous reviewer retry becomes locked", async () => {
    const initial = plan("open");
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: { planId: PLAN_ID } }))
      .mockRejectedValueOnce(new TypeError("response lost"));
    await renderEditor(initial);
    await act(async () => reviewerCheckbox("Grace Hopper")?.click());
    await act(async () => buttonNamed("Save round")?.click());
    await settle();

    expect(container.textContent).toContain("Reviewer assignment is still pending.");
    expect(buttonNamed("Retry reviewer assignments")?.disabled).toBe(false);

    const latest = {
      ...initial,
      status: "closed" as const,
      updatedAt: "2026-08-14T12:01:00.000Z",
    };
    await renderEditor(latest);

    expect(container.textContent).toContain("Round details are saved, but assignments are now locked.");
    expect(buttonNamed("Load latest round")).toBeDefined();
    expect(buttonNamed("Load latest to continue")?.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValueOnce(Response.json({ data: { plans: [latest] } }));
    await act(async () => buttonNamed("Load latest round")?.click());
    await settle();

    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/internal/evaluation/${EVENT_ID}/plans`, { method: "GET" });
    expect(container.textContent).toContain("Latest round loaded. Your reviewer changes are preserved.");
    expect(reviewerCheckbox("Grace Hopper")?.checked).toBe(true);
  });

  it.each([
    ["reopen then extend", ["status", "deadline"] as const],
    ["extend then reopen", ["deadline", "status"] as const],
  ])("stages %s while recovering assignments from a closed and expired round", async (_label, order) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T12:00:00.000Z"));
    const initial = plan("open");
    const latest = {
      ...initial,
      status: "closed" as const,
      closesAt: "2026-08-14T11:00:00.000Z",
      updatedAt: "2026-08-14T12:01:00.000Z",
    };
    const futureClose = "2026-08-15T12:00:00.000Z";
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: { planId: PLAN_ID } }))
      .mockResolvedValueOnce(Response.json({
        error: { code: "CONFLICT", message: "Reviewer assignments cannot change after this round closes" },
      }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ data: { plans: [latest] } }))
      .mockResolvedValueOnce(Response.json({ data: { planId: PLAN_ID } }))
      .mockResolvedValueOnce(Response.json({ data: {} }));
    await renderEditor(initial);
    await act(async () => reviewerCheckbox("Grace Hopper")?.click());
    await act(async () => buttonNamed("Save round")?.click());
    await settle();
    await act(async () => buttonNamed("Load latest round")?.click());
    await settle();

    const apply = async (step: "status" | "deadline") => {
      if (step === "status") await changeStatus("open");
      else await changeClosesAt(futureClose);
    };
    await apply(order[0]);

    expect(buttonNamed("Save round")?.disabled).toBe(true);
    expect(reviewerCheckbox("Grace Hopper")?.closest("fieldset")?.disabled).toBe(true);
    await apply(order[1]);

    expect(statusSelect()?.value).toBe("open");
    expect(closesAtInput()?.value).toBe(futureClose);
    expect(buttonNamed("Save round")?.disabled).toBe(false);
    expect(reviewerCheckbox("Grace Hopper")?.closest("fieldset")?.disabled).toBe(false);

    await act(async () => buttonNamed("Save round")?.click());
    await settle();

    const retryPlanBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)) as Record<string, unknown>;
    expect(retryPlanBody).toMatchObject({
      status: "open",
      closesAt: futureClose,
      expectedUpdatedAt: latest.updatedAt,
    });
    const retryReviewersBody = JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body)) as {
      reviewers: Array<{ userId: string }>;
    };
    expect(retryReviewersBody.reviewers.map((reviewer) => reviewer.userId)).toEqual([REVIEWER_ID, SECOND_REVIEWER_ID]);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves reviewer edits and loads the latest round after closure between save stages", async () => {
    const initial = {
      ...plan("open"),
      criteria: [{
        id: CRITERION_ID,
        label: "Recommendation",
        weight: 1,
        sortOrder: 0,
        kind: "select" as const,
        required: true,
        options: [{ id: OPTION_ID, label: "Strong accept", score: 5 }],
        minValue: null,
        maxValue: null,
      }],
    };
    const latest = {
      ...initial,
      status: "closed" as const,
      updatedAt: "2026-08-13T13:00:00.000Z",
      criteria: initial.criteria.map((criterion) => ({
        ...criterion,
        options: [{ id: OPTION_ID, label: "Recommend", score: 5 }],
      })),
    };
    fetchMock
      .mockResolvedValueOnce(Response.json({ data: { planId: PLAN_ID } }))
      .mockResolvedValueOnce(Response.json({
        error: {
          code: "CONFLICT",
          message: "Reviewer assignments cannot change after this round closes",
        },
      }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ data: { plans: [latest] } }))
      .mockResolvedValueOnce(Response.json({ data: { planId: PLAN_ID } }))
      .mockResolvedValueOnce(Response.json({ data: {} }));
    await renderEditor(initial);

    await act(async () => reviewerCheckbox("Grace Hopper")?.click());
    await act(async () => buttonNamed("Save round")?.click());
    await settle();

    expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Round details are saved, but assignments are now locked.");
    expect(buttonNamed("Load latest round")).toBeDefined();
    expect(buttonNamed("Load latest to continue")?.disabled).toBe(true);
    expect(reviewerCheckbox("Grace Hopper")?.checked).toBe(true);

    await act(async () => buttonNamed("Load latest round")?.click());
    await settle();

    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/internal/evaluation/${EVENT_ID}/plans`, { method: "GET" });
    expect(container.textContent).toContain("Latest round loaded. Your reviewer changes are preserved.");
    expect(container.textContent).toContain("Reopen this round before changing reviewer assignments.");
    expect(statusSelect()?.value).toBe("closed");
    expect(reviewerCheckbox("Grace Hopper")?.checked).toBe(true);
    expect(reviewerCheckbox("Grace Hopper")?.closest("fieldset")?.disabled).toBe(true);

    const status = statusSelect();
    await act(async () => {
      if (!status) return;
      status.value = "open";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(reviewerCheckbox("Grace Hopper")?.closest("fieldset")?.disabled).toBe(false);

    await act(async () => buttonNamed("Save round")?.click());
    await settle();

    const retryPlanBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)) as Record<string, unknown>;
    expect(retryPlanBody).toMatchObject({
      status: "open",
      expectedUpdatedAt: latest.updatedAt,
      criteria: [{
        id: CRITERION_ID,
        options: [{ id: OPTION_ID, label: "Recommend", score: 5 }],
      }],
    });
    const retryReviewersBody = JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body)) as {
      reviewers: Array<{ userId: string }>;
    };
    expect(retryReviewersBody.reviewers.map((reviewer) => reviewer.userId)).toEqual([REVIEWER_ID, SECOND_REVIEWER_ID]);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
