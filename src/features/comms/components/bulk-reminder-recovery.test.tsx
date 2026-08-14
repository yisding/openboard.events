/** @vitest-environment happy-dom */

import * as React from "react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contactIdSchema, eventIdSchema, taskIdSchema, type BulkReminderResult } from "@/shared/contracts";
import { bulkReminderRecoveryStorageKey } from "../bulk-reminder-recovery";
import { BulkReminderRecoveryDialog, useBulkReminderRecovery } from "./bulk-reminder-recovery";

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("e1000000-0000-4000-8000-000000000001");
const targets = [{
  taskId: taskIdSchema.parse("e1000000-0000-4000-8000-000000000002"),
  contactId: contactIdSchema.parse("e1000000-0000-4000-8000-000000000003"),
  submissionId: null,
}] as const;
const acknowledgedResult: BulkReminderResult = {
  enqueued: 0,
  total: 1,
  results: [{ ...targets[0], enqueued: false, attemptStatus: "sent" }],
};

let container: HTMLDivElement;
let root: Root;
const acknowledged = vi.fn();

function Harness() {
  const [selection, setSelection] = useState(1);
  const controller = useBulkReminderRecovery({
    eventId,
    surface: "files",
    onAcknowledged: (result) => {
      acknowledged(result);
      setSelection(0);
    },
  });
  return <>
    <span data-selection={selection}>{selection} selected</span>
    <button type="button" disabled={controller.blocked} onClick={() => void controller.start(targets)}>Start batch</button>
    <BulkReminderRecoveryDialog controller={controller} />
  </>;
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

async function settle() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  toastMock.mockReset();
  acknowledged.mockReset();
  window.localStorage.clear();
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async <T,>(
        _name: string,
        _options: { mode: "exclusive"; ifAvailable: true },
        callback: (lock: object) => T | PromiseLike<T>,
      ) => callback({}),
    },
  });
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
  vi.restoreAllMocks();
});

describe("bulk reminder recovery", () => {
  it("restores a lost-response batch and retries byte-identically once across a remount", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: acknowledgedResult }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));

    await act(async () => root.render(<Harness />));
    await act(async () => buttonNamed("Start batch")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    const firstBody = fetchMock.mock.calls[0]?.[1]?.body;
    const firstPayload = JSON.parse(String(firstBody)) as { targets: unknown[]; attemptId: string };
    expect(firstPayload).toEqual({
      targets,
      attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(buttonNamed("Start batch")?.disabled).toBe(true);
    expect(buttonNamed("Retry reminders")).toBeDefined();
    expect(buttonNamed("Cancel")?.disabled).toBe(true);
    expect(window.localStorage.getItem(bulkReminderRecoveryStorageKey(eventId))).not.toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    await settle();
    expect(buttonNamed("Retry reminders")).toBeDefined();
    expect(buttonNamed("Start batch")?.disabled).toBe(true);

    await act(async () => buttonNamed("Retry reminders")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(firstBody);
    expect(acknowledged).toHaveBeenCalledOnce();
    expect(acknowledged).toHaveBeenCalledWith(acknowledgedResult);
    expect(container.textContent).toContain("0 selected");
    expect(buttonNamed("Start batch")?.disabled).toBe(false);
    expect(window.localStorage.getItem(bulkReminderRecoveryStorageKey(eventId))).toBeNull();
    expect(toastMock.mock.calls.filter(([message]) => message === "Reminder status: 1 already sent")).toHaveLength(1);
  });

  it("fails safely without a POST when the recovery record cannot be written", async () => {
    const fetchMock = vi.mocked(fetch);
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("storage blocked");
    });

    await act(async () => root.render(<Harness />));
    await act(async () => buttonNamed("Start batch")?.click());
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(acknowledged).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      "Could not prepare a safe reminder retry. No reminders were sent.",
      { kind: "error" },
    );
  });

  it("fails safely without a POST when browser recovery storage cannot be acquired", async () => {
    const fetchMock = vi.mocked(fetch);
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("storage denied", "SecurityError");
    });

    await act(async () => root.render(<Harness />));
    await settle();
    await act(async () => buttonNamed("Start batch")?.click());
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(acknowledged).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(
      "Could not prepare a safe reminder retry. No reminders were sent.",
      { kind: "error" },
    );
  });

  it("keeps the exact batch locked when a successful HTTP response is malformed", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: { enqueued: 1, total: 2, results: [] },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await act(async () => root.render(<Harness />));
    await act(async () => buttonNamed("Start batch")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(buttonNamed("Retry reminders")).toBeDefined();
    expect(buttonNamed("Start batch")?.disabled).toBe(true);
    expect(window.localStorage.getItem(bulkReminderRecoveryStorageKey(eventId))).not.toBeNull();
    expect(acknowledged).not.toHaveBeenCalled();
  });
});
