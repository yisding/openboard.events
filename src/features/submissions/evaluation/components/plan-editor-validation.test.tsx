/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanDTO } from "../types";
import { PlanEditor, criterionWeightError, outgoingCriterionWeight } from "./plan-editor";

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

const EVENT_ID = "c4310000-0000-4000-8000-000000000001";
const PLAN_ID = "c4310000-0000-4000-8000-000000000010" as PlanDTO["id"];
const CRITERION_ID = "c4310000-0000-4000-8002-000000000013" as PlanDTO["criteria"][number]["id"];

const PLAN: PlanDTO = {
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
    label: "Quality",
    weight: 1,
    sortOrder: 0,
    kind: "numeric",
    required: true,
    options: [],
    minValue: null,
    maxValue: null,
  }],
  reviewers: [],
  progress: { scored: 0, total: 1 },
  updatedAt: "2026-08-13T12:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let onClose: ReturnType<typeof vi.fn>;

async function settle() {
  await act(async () => {
    for (let step = 0; step < 5; step += 1) await Promise.resolve();
  });
}

async function renderEditor() {
  await act(async () => {
    root.render(
      <PlanEditor
        eventId={EVENT_ID}
        plan={PLAN}
        tracks={[]}
        members={[]}
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

function weightInput(): HTMLInputElement | undefined {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')]
    .find((input) => input.closest("label")?.textContent?.startsWith("Weight"));
}

function roundNameInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>("input[required]");
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function typeSelect(): HTMLSelectElement | undefined {
  return [...container.querySelectorAll<HTMLSelectElement>("select")]
    .find((select) => select.closest("label")?.textContent?.startsWith("Type"));
}

async function changeSelect(select: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
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
  vi.unstubAllGlobals();
});

describe("evaluation plan editor validation", () => {
  it("states the weight rule for the values the server refuses", () => {
    expect(criterionWeightError({ kind: "numeric", weight: 1 })).toBeUndefined();
    expect(criterionWeightError({ kind: "numeric", weight: 100 })).toBeUndefined();
    expect(criterionWeightError({ kind: "numeric", weight: 0 })).toContain("above 0 and at most 100");
    expect(criterionWeightError({ kind: "select", weight: -2 })).toContain("above 0 and at most 100");
    expect(criterionWeightError({ kind: "numeric", weight: 101 })).toContain("above 0 and at most 100");
    // Written feedback never enters the mean, so its weight is not the
    // organizer's to get wrong.
    expect(criterionWeightError({ kind: "text", weight: 0 })).toBeUndefined();
  });

  // The Weight field is disabled for written feedback, so a leftover 0 from the
  // type it was switched away from is one the organizer cannot correct — and the
  // server refuses a 0 whatever the kind.
  it("sends a weight the server accepts for written feedback", async () => {
    expect(outgoingCriterionWeight({ kind: "text", weight: 0 })).toBe(1);
    expect(outgoingCriterionWeight({ kind: "text", weight: 3 })).toBe(3);
    expect(outgoingCriterionWeight({ kind: "numeric", weight: 0 })).toBe(0);

    await renderEditor();
    const weight = weightInput();
    const kind = typeSelect();
    expect(weight).toBeDefined();
    expect(kind).toBeDefined();
    if (!weight || !kind) return;

    await changeInput(weight, "0");
    await changeSelect(kind, "text");
    expect(buttonNamed("Save round")?.disabled).toBe(false);
    // The input is disabled at this point, so the 0 is unreachable and unfixable
    // — showing it would have the field narrate a number the payload below does
    // not carry.
    expect(weight.disabled).toBe(true);
    expect(weight.value).toBe("1");

    fetchMock.mockResolvedValueOnce(Response.json({ data: { planId: PLAN_ID } }));
    await act(async () => buttonNamed("Save round")?.click());
    await settle();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { criteria: Array<{ kind: string; weight: number }> };
    expect(body.criteria[0]).toMatchObject({ kind: "text", weight: 1 });
  });

  it("rejects an illegal weight at the field instead of at the server", async () => {
    await renderEditor();
    const weight = weightInput();
    expect(weight).toBeDefined();
    if (!weight) return;

    await changeInput(weight, "0");

    expect(container.textContent).toContain("Weight has to be above 0 and at most 100");
    expect(weight.getAttribute("aria-invalid")).toBe("true");
    expect(weight.closest("label")?.className).toContain("field-invalid");
    expect(buttonNamed("Save round")?.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the drawer and every edit when the server refuses the save", async () => {
    await renderEditor();
    const name = roundNameInput();
    expect(name).toBeDefined();
    if (!name) return;
    await changeInput(name, "Round 1 renamed");

    fetchMock.mockResolvedValueOnce(Response.json(
      { error: { code: "CONFLICT", message: "This round already has reviews." } },
      { status: 409 },
    ));
    await act(async () => buttonNamed("Save round")?.click());
    await settle();

    expect(toastMock).toHaveBeenCalledWith("This round already has reviews.", { kind: "error" });
    expect(onClose).not.toHaveBeenCalled();
    expect(roundNameInput()?.value).toBe("Round 1 renamed");
    expect(buttonNamed("Save round")?.disabled).toBe(false);
  });
});
