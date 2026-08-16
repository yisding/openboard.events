/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminTaskDTO } from "../server/queries";
import { settle } from "@tests/support/react";

const toastMock = vi.hoisted(() => vi.fn());
const routing = vi.hoisted(() => ({ pathname: "/events/one/tasks" }));

vi.mock("next/navigation", () => ({
  usePathname: () => routing.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/rich-text-editor-lazy", () => ({
  RichTextEditor: ({ value, onChange, ariaLabel }: { value: string; onChange: (value: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock("@/shared/ui/app/datetime-picker", () => ({
  DateTimePicker: () => <input aria-label="Due date" />,
}));

// Imported after the mocks so the editor and the guard share one provider.
const { TaskEditor } = await import("./task-editor");
const { UnsavedWorkGuardProvider, useGuardedAction } = await import("@/shared/ui/app/unsaved-work-guard");

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = "d5000000-0000-4000-8000-000000000001";
const task = {
  id: "d5000000-0000-4000-8000-000000000090",
  name: "Upload slides",
  descriptionHtml: "<p>Bring a PDF backup.</p>",
  targetType: "contact",
  completionMode: "manual",
  formId: null,
  fileRequestId: null,
  dueAt: null,
  isActive: true,
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T01:00:00.000Z",
  counts: { completed: 0, open: 3, overdue: 0, recorded: 0 },
} as AdminTaskDTO;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

/** The guard's own dialog — the editor has a "Cancel" of its own. */
function discardPrompt(): HTMLDialogElement | undefined {
  return [...document.querySelectorAll("dialog")]
    .find((dialog) => dialog.textContent?.includes("Discard unsaved work?"));
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  toastMock.mockReset();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

/**
 * The post-save handoff, as `TasksAdminView` performs it: the page reloads its
 * own list and calls `router.refresh()`. Both go through the unsaved-work
 * guard, so this is the moment that used to raise "Discard unsaved work?"
 * about a task that had already been written.
 */
describe("TaskEditor after a successful save", () => {
  it("lets the page run its own post-save refresh without a discard prompt", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      data: { ...task, name: "Upload final slides", updatedAt: "2026-08-11T02:00:00.000Z" },
    }));

    const refreshed = vi.fn();
    let guardedRefresh: (() => void) | null = null;

    function Screen() {
      const { runGuarded } = useGuardedAction();
      guardedRefresh = () => runGuarded(refreshed);
      return (
        <TaskEditor
          eventId={eventId}
          timezone="UTC"
          open
          task={task}
          duplicateOf={null}
          locked={false}
          forms={[]}
          fileRequests={[]}
          onClose={vi.fn()}
          onSaved={async () => { guardedRefresh?.(); }}
        />
      );
    }

    await act(async () => root.render(<UnsavedWorkGuardProvider><Screen /></UnsavedWorkGuardProvider>));
    await settle();

    const name = container.querySelector<HTMLInputElement>('input[placeholder="e.g. Upload final slides"]');
    if (!name) throw new Error("expected the task name input");
    await changeInput(name, "Upload final slides");

    // Guarded while the edit is genuinely unsaved.
    await act(async () => { guardedRefresh?.(); });
    expect(refreshed).not.toHaveBeenCalled();
    const prompt = discardPrompt();
    expect(prompt).toBeDefined();
    await act(async () => {
      [...(prompt?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
        .find((button) => button.textContent?.trim() === "Cancel")?.click();
    });
    expect(discardPrompt()).toBeUndefined();

    await act(async () => buttonNamed("Save changes")?.click());
    await settle();

    expect(toastMock).toHaveBeenCalledWith("Task updated");
    expect(refreshed).toHaveBeenCalledOnce();
    expect(discardPrompt()).toBeUndefined();
  });

  it("guards again once the organizer edits the saved task further", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      data: { ...task, name: "Upload final slides", updatedAt: "2026-08-11T02:00:00.000Z" },
    }));

    const left = vi.fn();
    let leave: (() => void) | null = null;

    function Screen() {
      const { runGuarded } = useGuardedAction();
      leave = () => runGuarded(left);
      return (
        <TaskEditor
          eventId={eventId}
          timezone="UTC"
          open
          task={task}
          duplicateOf={null}
          locked={false}
          forms={[]}
          fileRequests={[]}
          onClose={vi.fn()}
          onSaved={vi.fn()}
        />
      );
    }

    await act(async () => root.render(<UnsavedWorkGuardProvider><Screen /></UnsavedWorkGuardProvider>));
    await settle();

    const name = container.querySelector<HTMLInputElement>('input[placeholder="e.g. Upload final slides"]');
    if (!name) throw new Error("expected the task name input");
    await changeInput(name, "Upload final slides");
    await act(async () => buttonNamed("Save changes")?.click());
    await settle();

    await changeInput(name, "Upload final slides, please");
    await settle();
    await act(async () => { leave?.(); });

    expect(left).not.toHaveBeenCalled();
    expect(discardPrompt()).toBeDefined();
  });
});
