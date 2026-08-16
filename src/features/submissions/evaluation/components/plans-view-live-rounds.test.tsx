/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignableSubmission, PlanDTO } from "../types";
import { PlansView, withSavedPlan } from "./plans-view";
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
    <input data-date-picker value={value ?? ""} onChange={(event) => onChange(event.currentTarget.value || null)} />
  ),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const EVENT_ID = "c4400000-0000-4000-8000-000000000001";
const PLAN_ID = "c4400000-0000-4000-8000-000000000010" as PlanDTO["id"];
const ADA = "c4400000-0000-4000-8001-000000000011" as PlanDTO["reviewers"][number]["userId"];

function reviewer(assigned: number): PlanDTO["reviewers"][number] {
  return {
    userId: ADA,
    name: "Ada Lovelace",
    email: "ada@example.com",
    trackIds: null,
    assigned,
    completed: 0,
    recused: 0,
    outstanding: assigned,
    scored: 0,
  };
}

const ROUND_ONE: PlanDTO = {
  id: PLAN_ID,
  name: "Round 1",
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
  reviewers: [reviewer(0)],
  progress: { scored: 0, total: 2 },
  hasReviews: false,
  updatedAt: "2026-08-13T12:00:00.000Z",
};

const SUBMISSION: AssignableSubmission = {
  submissionId: "c4400000-0000-4000-8002-000000000021" as AssignableSubmission["submissionId"],
  code: 21,
  title: "A talk about caching",
  trackId: null,
  trackName: null,
  assignedTo: [],
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

async function renderPlans(plans: PlanDTO[] = [ROUND_ONE]) {
  await act(async () => {
    root.render(
      <PlansView
        eventId={EVENT_ID}
        plans={plans}
        tracks={[]}
        members={[{ userId: ADA, name: "Ada Lovelace", email: "ada@example.com", role: "reviewer" }]}
        pendingReviewerInvitations={[]}
        timezone="America/Los_Angeles"
      />,
    );
  });
  await settle();
}

function row(name: string): HTMLTableRowElement | undefined {
  return [...container.querySelectorAll<HTMLTableRowElement>("tbody tr")]
    .find((candidate) => candidate.textContent?.includes(name));
}

function rowButton(name: string, label: string): HTMLButtonElement | undefined {
  return [...(row(name)?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
    .find((button) => button.textContent?.trim() === label);
}

function buttonNamed(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === label);
}

function checkboxLabelled(text: string): HTMLInputElement | undefined {
  return [...container.querySelectorAll<HTMLLabelElement>("label.assignment-choice")]
    .find((label) => label.textContent?.includes(text))
    ?.querySelector<HTMLInputElement>('input[type="checkbox"]') ?? undefined;
}

async function click(element: HTMLElement | undefined) {
  await act(async () => element?.click());
  await settle();
}

beforeEach(() => {
  routerMock.refresh.mockReset();
  toastMock.mockReset();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("evaluation round list after a write", () => {
  it("shows the assignment the toast just confirmed, without a reload", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ data: { submissions: [SUBMISSION] } }));
    await renderPlans();
    expect(row("Round 1")?.textContent).toContain("0/0");

    await click(rowButton("Round 1", "Assign"));
    await click(checkboxLabelled("Ada Lovelace"));
    await click(checkboxLabelled("A talk about caching"));

    fetchMock.mockResolvedValueOnce(Response.json({
      data: { assigned: 1, removed: 0, plan: { ...ROUND_ONE, reviewers: [reviewer(1)] } },
    }));
    await click(buttonNamed("Assign 1"));

    expect(toastMock).toHaveBeenCalledWith("1 assigned");
    // The props never changed: this is the round the write answered with.
    expect(row("Round 1")?.textContent).toContain("0/1");
    expect(routerMock.refresh).toHaveBeenCalledOnce();
  });

  it("shows the round setting an edit just saved, without a reload", async () => {
    await renderPlans();
    expect(row("Round 1")?.textContent).toContain("Independent scoring");

    await click(rowButton("Round 1", "Edit"));
    await click(buttonNamed("Share committee averages with reviewers"));

    fetchMock.mockResolvedValueOnce(Response.json({
      data: {
        planId: PLAN_ID,
        plan: { ...ROUND_ONE, showPeerScores: true, updatedAt: "2026-08-13T13:00:00.000Z" },
      },
    }));
    await click(buttonNamed("Save round"));

    expect(toastMock).toHaveBeenCalledWith("Round 1 updated");
    expect(row("Round 1")?.textContent).toContain("Committee averages shared");
    expect(routerMock.refresh).toHaveBeenCalledOnce();
  });

  it("lets the next server snapshot overrule what a write left on screen", async () => {
    await renderPlans();
    await click(rowButton("Round 1", "Edit"));
    await click(buttonNamed("Share committee averages with reviewers"));
    fetchMock.mockResolvedValueOnce(Response.json({
      data: { planId: PLAN_ID, plan: { ...ROUND_ONE, showPeerScores: true, updatedAt: "2026-08-13T13:00:00.000Z" } },
    }));
    await click(buttonNamed("Save round"));
    expect(row("Round 1")?.textContent).toContain("Committee averages shared");

    // What `router.refresh()` eventually delivers is the authority, even when
    // it disagrees — a second organizer may have turned the setting back off.
    await renderPlans([{ ...ROUND_ONE, showPeerScores: false, updatedAt: "2026-08-13T14:00:00.000Z" }]);

    expect(row("Round 1")?.textContent).toContain("Independent scoring");
  });

  it("takes a deleted round off the list as soon as the server confirms it", async () => {
    await renderPlans();
    await click(rowButton("Round 1", "Delete"));

    fetchMock.mockResolvedValueOnce(Response.json({ data: { deleted: true } }));
    await click(buttonNamed("Delete plan"));

    expect(toastMock).toHaveBeenCalledWith("Round 1 deleted");
    expect(row("Round 1")).toBeUndefined();
    expect(container.textContent).toContain("No evaluation plans yet");
  });

  it("keeps a created round in the order the server would have listed it in", () => {
    const roundTwo = { ...ROUND_ONE, id: "c4400000-0000-4000-8000-000000000020" as PlanDTO["id"], name: "Round 2", round: 2 };
    const roundThree = { ...ROUND_ONE, id: "c4400000-0000-4000-8000-000000000030" as PlanDTO["id"], name: "Round 3", round: 3 };

    expect(withSavedPlan([ROUND_ONE, roundThree], roundTwo).map((plan) => plan.name))
      .toEqual(["Round 1", "Round 2", "Round 3"]);
    expect(withSavedPlan([ROUND_ONE], { ...ROUND_ONE, name: "Renamed" }).map((plan) => plan.name))
      .toEqual(["Renamed"]);
  });
});
