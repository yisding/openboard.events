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
    <input data-date-picker value={value ?? ""} onChange={(event) => onChange(event.currentTarget.value || null)} />
  ),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const EVENT_ID = "c4500000-0000-4000-8000-000000000001";
const PLAN_ID = "c4500000-0000-4000-8000-000000000010" as PlanDTO["id"];
const CRITERION_ID = "c4500000-0000-4000-8002-000000000013" as PlanDTO["criteria"][number]["id"];

const REVIEWED_ROUND: PlanDTO = {
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
  criteria: [{
    id: CRITERION_ID,
    label: "Relevance",
    weight: 2,
    sortOrder: 0,
    kind: "select",
    required: true,
    options: [{ id: "strong", label: "Strong accept", score: 5 }],
    minValue: null,
    maxValue: null,
  }],
  reviewers: [],
  progress: { scored: 1, total: 3 },
  hasReviews: true,
  updatedAt: "2026-08-13T12:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

async function renderEditor(plan: PlanDTO) {
  await act(async () => {
    root.render(
      <PlanEditor
        eventId={EVENT_ID}
        plan={plan}
        tracks={[]}
        members={[]}
        nextRound={2}
        timezone="America/Los_Angeles"
        onSaved={vi.fn()}
        onClose={vi.fn()}
      />,
    );
  });
  await settle();
}

function fieldControl(labelPrefix: string): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined {
  return [...container.querySelectorAll<HTMLLabelElement>("label")]
    .find((label) => label.textContent?.startsWith(labelPrefix))
    ?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea") ?? undefined;
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function removeCriterionButton(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('button[aria-label="Remove Relevance"]');
}

beforeEach(() => {
  routerMock.refresh.mockReset();
  toastMock.mockReset();
  vi.stubGlobal("fetch", vi.fn<typeof fetch>());
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

describe("evaluation round editor on a round that already has reviews", () => {
  it("locks the scale and criteria the server would refuse, and says why", async () => {
    await renderEditor(REVIEWED_ROUND);

    expect(fieldControl("Scale low")?.disabled).toBe(true);
    expect(fieldControl("Scale high")?.disabled).toBe(true);
    expect(fieldControl("Type")?.disabled).toBe(true);
    expect(fieldControl("Weight")?.disabled).toBe(true);
    expect(fieldControl("Choices")?.disabled).toBe(true);
    expect(removeCriterionButton()?.disabled).toBe(true);
    expect(buttonNamed("Add criterion")?.disabled).toBe(true);
    expect(container.textContent).toContain("This round already has reviews, so its scale and criteria are fixed.");
  });

  it("locks a round whose only review is still unfinished", async () => {
    // `assertScoringShapeEditable` refuses on any review row, finished or not,
    // so the lock cannot be read off finished-review progress: a round showing
    // 0 scored out of 3 is already frozen the moment a reviewer opens it.
    await renderEditor({ ...REVIEWED_ROUND, progress: { scored: 0, total: 3 } });

    expect(fieldControl("Scale low")?.disabled).toBe(true);
    expect(fieldControl("Scale high")?.disabled).toBe(true);
    expect(buttonNamed("Add criterion")?.disabled).toBe(true);
    expect(container.textContent).toContain("This round already has reviews, so its scale and criteria are fixed.");
  });

  it("keeps the round's name, window and criterion wording editable", async () => {
    await renderEditor(REVIEWED_ROUND);

    // Everything `assertScoringShapeEditable` still accepts stays open: a
    // reworded criterion re-values nothing.
    expect(fieldControl("Round name")?.disabled).toBe(false);
    expect(fieldControl("Label")?.disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Relevance is required"]')?.disabled).toBe(false);
    expect(fieldControl("Status")?.disabled).toBe(false);
    expect(buttonNamed("Save round")?.disabled).toBe(false);
  });

  it("leaves a round nobody has reviewed completely editable", async () => {
    await renderEditor({ ...REVIEWED_ROUND, hasReviews: false, progress: { scored: 0, total: 3 } });

    expect(fieldControl("Scale low")?.disabled).toBe(false);
    expect(fieldControl("Scale high")?.disabled).toBe(false);
    expect(fieldControl("Type")?.disabled).toBe(false);
    expect(fieldControl("Weight")?.disabled).toBe(false);
    expect(fieldControl("Choices")?.disabled).toBe(false);
    expect(removeCriterionButton()?.disabled).toBe(false);
    expect(buttonNamed("Add criterion")?.disabled).toBe(false);
    expect(container.textContent).not.toContain("This round already has reviews");
  });
});
