/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import type { ReminderRuleRow } from "@/features/comms";
import { RemindersTab } from "./reminders-tab";

const saveMock = vi.hoisted(() => vi.fn(async () => undefined));
const rulesHookState = vi.hoisted(() => ({ data: [] as ReminderRuleRow[] }));

vi.mock("../hooks/use-reminder-rules", () => ({
  useReminderRules: () => ({ data: rulesHookState.data }),
  useSaveReminderRules: () => ({ mutateAsync: saveMock, isPending: false }),
}));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({ useUnsavedWorkGuard: vi.fn() }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("e5000000-0000-4000-8000-000000000001");
const SEEDED_LADDER: ReminderRuleRow[] = [-7, -1, 1].map((offsetDays, index) => ({
  id: `e5000000-0000-4000-8000-00000000001${index}`,
  offsetDays,
  enabled: true,
})) as ReminderRuleRow[];

let container: HTMLDivElement;
let root: Root;

async function mount(rules: ReminderRuleRow[] = SEEDED_LADDER) {
  rulesHookState.data = rules;
  await act(async () => root.render(<RemindersTab eventId={eventId} />));
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === name || button.getAttribute("aria-label") === name,
  );
}

function offsetInputs(): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('input[type="number"]')];
}

async function typeOffset(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  saveMock.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("RemindersTab ladder editing", () => {
  it("adds a rung on an offset nothing else uses", async () => {
    await mount();

    await act(async () => buttonNamed("Add rung")?.click());

    const offsets = offsetInputs().map((input) => input.value);
    expect(offsets).toEqual(["-7", "-1", "1", "-8"]);
    expect(new Set(offsets).size).toBe(offsets.length);
  });

  // The server keys rungs by offset, so a colliding set is silently merged and
  // a rung disappears on save. Refuse the save and say which field is wrong.
  it("blocks the save when two rungs collide on one offset instead of merging them", async () => {
    await mount();
    const [first] = offsetInputs();
    if (!first) throw new Error("No offset input was rendered");

    await typeOffset(first, "-1");

    expect(container.textContent).toContain("Another rung already uses this offset");
    expect(buttonNamed("Save reminder rules")?.disabled).toBe(true);

    await typeOffset(first, "-14");

    expect(container.textContent).not.toContain("Another rung already uses this offset");
    expect(buttonNamed("Save reminder rules")?.disabled).toBe(false);
  });

  it("removes a rung explicitly, and names the way back once the ladder is empty", async () => {
    await mount();

    for (const label of ["Remove rung: 7 days before due", "Remove rung: 1 day before due", "Remove rung: 1 day after due"]) {
      await act(async () => buttonNamed(label)?.click());
    }

    expect(offsetInputs()).toHaveLength(0);
    expect(container.textContent).toContain("No reminder rungs");
    // D5: the terminal state names its next action, not only its consequence.
    expect(buttonNamed("Add rung")).toBeDefined();
  });
});
