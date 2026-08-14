/** @vitest-environment happy-dom */

import * as React from "react";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contactIdSchema, eventIdSchema, taskIdSchema, type BulkReminderResult } from "@/shared/contracts";
import { bulkReminderRecoveryStorageKey, bulkReminderTargetSetFingerprint, createBulkReminderRecovery, type BulkReminderSurface } from "../bulk-reminder-recovery";
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
const otherTargets = [{
  taskId: taskIdSchema.parse("e1000000-0000-4000-8000-000000000004"),
  contactId: contactIdSchema.parse("e1000000-0000-4000-8000-000000000005"),
  submissionId: null,
}] as const;
const tabAId = "e1000000-0000-4000-8000-000000000006";
const tabBId = "e1000000-0000-4000-8000-000000000007";
const acknowledgedResult: BulkReminderResult = {
  enqueued: 0,
  total: 1,
  results: [{ ...targets[0], enqueued: false, attemptStatus: "sent" }],
};

let container: HTMLDivElement;
let root: Root;
const acknowledged = vi.fn();
const scopedAcknowledged = vi.fn();

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
    <button type="button" disabled={controller.blocked || selection === 0} onClick={() => void controller.start(targets)}>Start batch</button>
    <BulkReminderRecoveryDialog controller={controller} />
  </>;
}

function ScopedHarness({
  label,
  surface,
  originId,
  selectedTargets,
  initialSelection,
}: {
  label: string;
  surface: BulkReminderSurface;
  originId: string;
  selectedTargets: typeof targets | typeof otherTargets;
  initialSelection: number;
}) {
  const [selection, setSelection] = useState(initialSelection);
  const controller = useBulkReminderRecovery({
    eventId,
    surface,
    originId,
    getSelectionFingerprint: () => selection > 0
      ? bulkReminderTargetSetFingerprint(selectedTargets)
      : null,
    onAcknowledged: (result) => {
      scopedAcknowledged(label, result);
      setSelection(0);
    },
  });
  return <section data-controller={label}>
    <span>{selection} selected</span>
    <button
      type="button"
      disabled={controller.blocked || selection === 0}
      onClick={() => void controller.start(selectedTargets)}
    >Start {label}</button>
  </section>;
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
  scopedAcknowledged.mockReset();
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
    expect(buttonNamed("Start batch")?.disabled).toBe(true);
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

  it("keeps the unresolved marker locked when the confirmed result cannot be persisted, then checks the exact attempt", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: acknowledgedResult }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const nativeSetItem = window.localStorage.setItem.bind(window.localStorage);
    let unresolvedValue: string | null = null;
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation((key, value) => {
      const parsed = JSON.parse(value) as { resolution?: unknown };
      if (parsed.resolution) throw new DOMException("quota exceeded", "QuotaExceededError");
      unresolvedValue = value;
      nativeSetItem(key, value);
    });

    await act(async () => root.render(<Harness />));
    await act(async () => buttonNamed("Start batch")?.click());
    await settle();

    const key = bulkReminderRecoveryStorageKey(eventId);
    const firstBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(key)).toBe(unresolvedValue);
    expect(JSON.parse(window.localStorage.getItem(key) as string)).not.toHaveProperty("resolution");
    expect(acknowledged).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 selected");
    expect(buttonNamed("Start batch")?.disabled).toBe(true);
    expect(buttonNamed("Check reminder status")).toBeDefined();
    expect(buttonNamed("Retry reminders")).toBeUndefined();
    expect(toastMock).toHaveBeenCalledWith(
      "The reminder outcome was confirmed, but browser recovery could not save it. Check this exact attempt again; no new attempt can start.",
      { kind: "error" },
    );

    setItem.mockImplementation(nativeSetItem);
    await act(async () => buttonNamed("Check reminder status")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(firstBody);
    expect(acknowledged).toHaveBeenCalledOnce();
    expect(acknowledged).toHaveBeenCalledWith(acknowledgedResult);
    expect(container.textContent).toContain("0 selected");
    expect(window.localStorage.getItem(key)).toBeNull();
    expect(buttonNamed("Check reminder status")).toBeUndefined();
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

  it("reloads a newer authoritative attempt inside the lock and ignores delayed old events", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new TypeError("response lost"));

    await act(async () => root.render(<Harness />));
    await act(async () => buttonNamed("Start batch")?.click());
    await settle();
    const key = bulkReminderRecoveryStorageKey(eventId);
    const oldValue = window.localStorage.getItem(key);
    expect(oldValue).not.toBeNull();
    const oldResolvedValue = JSON.stringify({
      ...JSON.parse(oldValue as string) as object,
      resolution: { kind: "result", result: acknowledgedResult },
    });
    const newRecovery = createBulkReminderRecovery(
      eventId,
      "speakers",
      otherTargets,
      tabBId,
      "e1000000-0000-4000-8000-000000000008",
    );
    const newValue = JSON.stringify(newRecovery);

    // Tab B completes/removes A's generation and starts a new one before A
    // receives any of those storage events.
    window.localStorage.setItem(key, oldResolvedValue);
    window.localStorage.removeItem(key);
    window.localStorage.setItem(key, newValue);

    await act(async () => buttonNamed("Retry reminders")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(acknowledged).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 selected");
    expect(buttonNamed("Retry reminders")).toBeDefined();
    expect(window.localStorage.getItem(key)).toBe(newValue);

    // The old resolved/removal pair arrives late and twice. Current storage
    // remains the authority, so neither event clears A's unrelated selection
    // or replaces B's global recovery marker.
    for (let duplicate = 0; duplicate < 2; duplicate += 1) {
      await act(async () => {
        window.dispatchEvent(new StorageEvent("storage", {
          key,
          oldValue,
          newValue: oldResolvedValue,
          storageArea: window.localStorage,
        }));
        window.dispatchEvent(new StorageEvent("storage", {
          key,
          oldValue: oldResolvedValue,
          newValue: null,
          storageArea: window.localStorage,
        }));
      });
    }
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(acknowledged).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 selected");
    expect(window.localStorage.getItem(key)).toBe(newValue);
  });

  it("adopts a resolved marker inside the lock without re-posting", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new TypeError("response lost"));

    await act(async () => root.render(<Harness />));
    await act(async () => buttonNamed("Start batch")?.click());
    await settle();
    const key = bulkReminderRecoveryStorageKey(eventId);
    const unresolvedValue = window.localStorage.getItem(key);
    const resolvedValue = JSON.stringify({
      ...JSON.parse(unresolvedValue as string) as object,
      resolution: { kind: "result", result: acknowledgedResult },
    });
    window.localStorage.setItem(key, resolvedValue);

    await act(async () => buttonNamed("Retry reminders")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(acknowledged).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("0 selected");
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("restores a missing marker inside the lock before a later exact retry", async () => {
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
    const key = bulkReminderRecoveryStorageKey(eventId);
    const firstBody = fetchMock.mock.calls[0]?.[1]?.body;
    window.localStorage.removeItem(key);

    await act(async () => buttonNamed("Retry reminders")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(acknowledged).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(key)).not.toBeNull();
    expect(buttonNamed("Retry reminders")).toBeDefined();

    await act(async () => buttonNamed("Retry reminders")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(firstBody);
    expect(acknowledged).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("acknowledges a Files selection before unlocking when another tab finishes the exact attempt", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new TypeError("response lost"));

    await act(async () => root.render(<Harness />));
    await act(async () => buttonNamed("Start batch")?.click());
    await settle();
    const key = bulkReminderRecoveryStorageKey(eventId);
    const oldValue = window.localStorage.getItem(key);
    expect(oldValue).not.toBeNull();
    const resolvedValue = JSON.stringify({
      ...JSON.parse(oldValue as string) as object,
      resolution: { kind: "result", result: acknowledgedResult },
    });

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
    await settle();
    expect(buttonNamed("Retry reminders")).toBeDefined();

    window.localStorage.setItem(key, resolvedValue);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue,
        newValue: resolvedValue,
        storageArea: window.localStorage,
      }));
    });
    window.localStorage.removeItem(key);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue: resolvedValue,
        newValue: null,
        storageArea: window.localStorage,
      }));
    });
    await settle();

    expect(acknowledged).toHaveBeenCalledOnce();
    expect(acknowledged).toHaveBeenCalledWith(acknowledgedResult);
    expect(container.textContent).toContain("0 selected");
    expect(buttonNamed("Start batch")?.disabled).toBe(true);
    expect(buttonNamed("Retry reminders")).toBeUndefined();
    expect(toastMock).toHaveBeenCalledWith("Reminder status: 1 already sent", undefined);

    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue: resolvedValue,
        newValue: null,
        storageArea: window.localStorage,
      }));
      buttonNamed("Start batch")?.click();
    });
    await settle();

    expect(acknowledged).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not infer success or unlock when another tab deletes an unresolved attempt", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new TypeError("response lost"));

    await act(async () => root.render(<Harness />));
    await act(async () => buttonNamed("Start batch")?.click());
    await settle();
    const key = bulkReminderRecoveryStorageKey(eventId);
    const oldValue = window.localStorage.getItem(key);
    expect(oldValue).not.toBeNull();

    window.localStorage.removeItem(key);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue,
        newValue: null,
        storageArea: window.localStorage,
      }));
    });
    await settle();

    expect(acknowledged).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 selected");
    expect(buttonNamed("Start batch")?.disabled).toBe(true);
    expect(buttonNamed("Retry reminders")).toBeDefined();
    expect(window.localStorage.getItem(key)).toBe(oldValue);
    expect(toastMock).toHaveBeenCalledWith(
      "Saved reminder recovery was removed before its outcome was confirmed. Retry the exact batch to continue.",
      { kind: "error" },
    );
  });

  it("unlocks a remotely confirmed refusal without falsely acknowledging or clearing the selection", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new TypeError("response lost"));

    await act(async () => root.render(<Harness />));
    await act(async () => buttonNamed("Start batch")?.click());
    await settle();
    const key = bulkReminderRecoveryStorageKey(eventId);
    const unresolvedValue = window.localStorage.getItem(key);
    expect(unresolvedValue).not.toBeNull();
    const resolvedValue = JSON.stringify({
      ...JSON.parse(unresolvedValue as string) as object,
      resolution: { kind: "error", message: "That assignment is no longer open" },
    });

    window.localStorage.setItem(key, resolvedValue);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue: unresolvedValue,
        newValue: resolvedValue,
        storageArea: window.localStorage,
      }));
    });
    window.localStorage.removeItem(key);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue: resolvedValue,
        newValue: null,
        storageArea: window.localStorage,
      }));
    });
    await settle();

    expect(acknowledged).not.toHaveBeenCalled();
    expect(container.textContent).toContain("1 selected");
    expect(buttonNamed("Start batch")?.disabled).toBe(false);
    expect(buttonNamed("Retry reminders")).toBeUndefined();
    expect(toastMock).toHaveBeenCalledWith("That assignment is no longer open", { kind: "error" });
  });

  it("clears only the originating surface and exact target selection across controllers", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new TypeError("response lost"));

    await act(async () => root.render(<>
      <ScopedHarness label="Speakers origin" surface="speakers" originId={tabAId} selectedTargets={targets} initialSelection={3} />
      <ScopedHarness label="Files draft" surface="files" originId={tabAId} selectedTargets={otherTargets} initialSelection={80} />
      <ScopedHarness label="Speakers other targets" surface="speakers" originId={tabAId} selectedTargets={otherTargets} initialSelection={2} />
      <ScopedHarness label="Speakers other tab" surface="speakers" originId={tabBId} selectedTargets={targets} initialSelection={3} />
    </>));
    await act(async () => buttonNamed("Start Speakers origin")?.click());
    await settle();

    const key = bulkReminderRecoveryStorageKey(eventId);
    const unresolvedValue = window.localStorage.getItem(key);
    expect(unresolvedValue).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue: null,
        newValue: unresolvedValue,
        storageArea: window.localStorage,
      }));
    });
    const resolvedValue = JSON.stringify({
      ...JSON.parse(unresolvedValue as string) as object,
      resolution: { kind: "result", result: acknowledgedResult },
    });
    window.localStorage.setItem(key, resolvedValue);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue: unresolvedValue,
        newValue: resolvedValue,
        storageArea: window.localStorage,
      }));
    });
    window.localStorage.removeItem(key);
    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue: resolvedValue,
        newValue: null,
        storageArea: window.localStorage,
      }));
    });
    await settle();

    expect(scopedAcknowledged).toHaveBeenCalledOnce();
    expect(scopedAcknowledged).toHaveBeenCalledWith("Speakers origin", acknowledgedResult);
    expect(container.querySelector('[data-controller="Speakers origin"]')?.textContent).toContain("0 selected");
    expect(container.querySelector('[data-controller="Files draft"]')?.textContent).toContain("80 selected");
    expect(container.querySelector('[data-controller="Speakers other targets"]')?.textContent).toContain("2 selected");
    expect(container.querySelector('[data-controller="Speakers other tab"]')?.textContent).toContain("3 selected");
    expect(buttonNamed("Start Files draft")?.disabled).toBe(false);
    expect(buttonNamed("Start Speakers other targets")?.disabled).toBe(false);
    expect(buttonNamed("Start Speakers other tab")?.disabled).toBe(false);

    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue: resolvedValue,
        newValue: null,
        storageArea: window.localStorage,
      }));
      buttonNamed("Start Speakers origin")?.click();
    });
    await settle();

    expect(scopedAcknowledged).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
