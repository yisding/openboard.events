/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanDTO } from "../types";
import { PlanEditor } from "./plan-editor";

const routerMock = vi.hoisted(() => ({ refresh: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: vi.fn(),
  useGuardedAction: () => ({ runGuarded: (action: () => void) => action() }),
}));
vi.mock("@/shared/ui/app/datetime-picker", () => ({
  DateTimePicker: ({ value }: { value: string | null }) => <span data-date-value={value ?? ""} />,
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const EVENT_ID = "c4300000-0000-4000-8000-000000000001";
const PLAN_ID = "c4300000-0000-4000-8000-000000000010" as PlanDTO["id"];
const REVIEWER_ID = "c4300000-0000-4000-8001-000000000011" as PlanDTO["reviewers"][number]["userId"];
const SECOND_REVIEWER_ID = "c4300000-0000-4000-8001-000000000012";

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

async function settle() {
  await act(async () => {
    for (let step = 0; step < 5; step += 1) await Promise.resolve();
  });
}

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

  it("preserves reviewer edits and loads the latest round after closure between save stages", async () => {
    const latest = {
      ...plan("closed"),
      updatedAt: "2026-08-13T13:00:00.000Z",
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
    await renderEditor(plan("open"));

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
    });
    const retryReviewersBody = JSON.parse(String(fetchMock.mock.calls[4]?.[1]?.body)) as {
      reviewers: Array<{ userId: string }>;
    };
    expect(retryReviewersBody.reviewers.map((reviewer) => reviewer.userId)).toEqual([REVIEWER_ID, SECOND_REVIEWER_ID]);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
