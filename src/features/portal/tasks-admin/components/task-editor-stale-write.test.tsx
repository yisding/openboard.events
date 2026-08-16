/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminTaskDTO } from "../server/queries";
import { TaskEditor } from "./task-editor";
import { settle } from "@tests/support/react";

const toastMock = vi.hoisted(() => vi.fn());
const runGuardedMock = vi.hoisted(() => vi.fn((action: () => void) => action()));

vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => () => undefined,
  useGuardedAction: () => ({ runGuarded: runGuardedMock }),
}));
vi.mock("@/shared/ui/app/rich-text-editor-lazy", () => ({
  RichTextEditor: ({ value, onChange, ariaLabel }: { value: string; onChange: (value: string) => void; ariaLabel: string }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock("@/shared/ui/app/datetime-picker", () => ({
  DateTimePicker: () => <input aria-label="Due date" />,
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = "d5000000-0000-4000-8000-000000000001";
const originalTask = {
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
  counts: { completed: 0, open: 3, overdue: 0 },
} as AdminTaskDTO;

const latestTask = {
  ...originalTask,
  name: "Upload final slides",
  isActive: false,
  updatedAt: "2026-08-11T02:00:00.000Z",
};
const savedAfterReload = {
  ...latestTask,
  name: "Upload final slides by Friday",
  updatedAt: "2026-08-11T03:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;


function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  toastMock.mockReset();
  runGuardedMock.mockClear();
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

describe("TaskEditor stale-write recovery", () => {
  it("preserves the draft after conflict and replaces it only after confirmed Load latest", async () => {
    const onSaved = vi.fn();
    fetchMock
      .mockResolvedValueOnce(Response.json({
        error: { code: "STALE_WRITE", message: "This task changed since you opened it" },
      }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ data: { task: latestTask, assignments: [] } }))
      .mockResolvedValueOnce(Response.json({ data: savedAfterReload }));

    await act(async () => root.render(
      <TaskEditor
        eventId={eventId}
        timezone="UTC"
        open
        task={originalTask}
        duplicateOf={null}
        locked={false}
        forms={[]}
        fileRequests={[]}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    ));
    await settle();

    const name = container.querySelector<HTMLInputElement>('input[placeholder="e.g. Upload final slides"]');
    if (!name) throw new Error("expected task name input");
    await changeInput(name, "Organizer B's due-date draft");
    await act(async () => buttonNamed("Save changes")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      name: "Organizer B's due-date draft",
      expectedUpdatedAt: originalTask.updatedAt,
      isActive: true,
    });
    expect(name.value).toBe("Organizer B's due-date draft");
    expect(onSaved).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("This task changed since you opened it");
    expect(buttonNamed("Save changes")?.disabled).toBe(true);

    await act(async () => buttonNamed("Load latest")?.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Your unsaved task changes will be replaced");

    const loadButtons = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .filter((button) => button.textContent?.trim() === "Load latest");
    await act(async () => loadButtons.at(-1)?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`/api/internal/tasks/${originalTask.id}?eventId=${eventId}`);
    expect(fetchMock.mock.calls[1]?.[1]).toBeUndefined();
    expect(name.value).toBe("Upload final slides");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(buttonNamed("Save changes")?.disabled).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith("Latest task loaded");

    await changeInput(name, savedAfterReload.name);
    await act(async () => buttonNamed("Save changes")?.click());
    await settle();

    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
      name: savedAfterReload.name,
      expectedUpdatedAt: latestTask.updatedAt,
      isActive: false,
    });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      id: savedAfterReload.id,
      name: savedAfterReload.name,
      isActive: false,
      updatedAt: savedAfterReload.updatedAt,
    }));
  });
});
