/** @vitest-environment happy-dom */

import * as React from "react";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BULK_REMINDER_TARGET_LIMIT,
  contactIdSchema,
  deliverableRowDtoSchema,
  eventIdSchema,
  fileRequestIdSchema,
  taskIdSchema,
  type BulkReminderResult,
  type DeliverableRowDTO,
} from "@/shared/contracts";
import type { DataTableSelectionContext } from "@/shared/ui/app/data-table";
import { bulkReminderRecoveryStorageKey } from "@/features/comms/bulk-reminder-recovery";
import { FilesAdminView } from "./files-admin-view";
import { settle } from "@tests/support/react";

const toastMock = vi.hoisted(() => vi.fn());
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  params: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/events/11111111-1111-4111-8111-111111111111/files",
  useSearchParams: () => navigation.params,
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: () => undefined,
  useGuardedAction: () => ({ runGuarded: (action: () => void) => action() }),
}));
vi.mock("@/shared/ui/app/data-table", () => ({
  DataTable: <Row,>({
    data,
    onSelectionChange,
    renderSelectionBar,
    selectionEpoch,
  }: {
    data: Row[];
    onSelectionChange?: (rows: Row[]) => void;
    renderSelectionBar?: (selection: DataTableSelectionContext<Row>) => React.ReactNode;
    selectionEpoch?: number;
  }) => {
    const [selected, setSelected] = useState<Row[]>([]);
    useEffect(() => {
      setSelected([]);
      onSelectionChange?.([]);
    }, [onSelectionChange, selectionEpoch]);
    const update = (next: Row[]) => {
      setSelected(next);
      onSelectionChange?.(next);
    };
    return <div>
      <button type="button" onClick={() => update(data.slice(0, 1))}>Select Ada</button>
      <button type="button" onClick={() => update(data)}>Select all rows</button>
      {renderSelectionBar?.({
        selectedRows: selected,
        countLabel: `${selected.length} selected`,
        clearSelection: () => update([]),
        scope: "page",
        pageSelectedCount: selected.length,
        pageRowCount: data.length,
        totalRowCount: data.length,
        selectAllRows: () => update(data),
      })}
    </div>;
  },
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("e2000000-0000-4000-8000-000000000001");
const taskId = taskIdSchema.parse("e2000000-0000-4000-8000-000000000002");
const contactId = contactIdSchema.parse("e2000000-0000-4000-8000-000000000003");
const fileRequestId = fileRequestIdSchema.parse("e2000000-0000-4000-8000-000000000004");
const row: DeliverableRowDTO = deliverableRowDtoSchema.parse({
  taskId,
  taskName: "Upload slides",
  fileRequestId,
  fileRequestTitle: "Final slides",
  contactId,
  contactName: "Ada Lovelace",
  submissionId: null,
  submissionTitle: null,
  dueAt: null,
  completed: false,
  completedAt: null,
  overdue: false,
  latestVersion: null,
  versionCount: 0,
  commentCount: 0,
});
const result: BulkReminderResult = {
  enqueued: 1,
  total: 1,
  results: [{ taskId, contactId, submissionId: null, enqueued: true, attemptStatus: "queued" }],
};

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.replace(/\s+/gu, " ").trim() === name);
}


beforeEach(() => {
  toastMock.mockReset();
  navigation.push.mockReset();
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

describe("Files bulk reminder recovery", () => {
  it("keeps an over-budget selection intact and sends nothing", async () => {
    const rows = Array.from({ length: BULK_REMINDER_TARGET_LIMIT + 1 }, (_, index) => deliverableRowDtoSchema.parse({
      ...row,
      taskId: `e2000000-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
      contactId: `e2000000-0000-4000-8001-${String(100 + index).padStart(12, "0")}`,
      fileRequestId: `e2000000-0000-4000-8002-${String(100 + index).padStart(12, "0")}`,
      contactName: `Speaker ${index + 1}`,
    }));
    await act(async () => root.render(<FilesAdminView
      eventId={eventId}
      rows={rows}
      counts={{ all: rows.length, open: rows.length, overdue: 0, completed: 0 }}
      state="all"
      taskId=""
      fileRequestId=""
      hasUpload=""
      search=""
      fileRequests={[]}
      tasks={[]}
    />));

    await act(async () => buttonNamed("Select all rows")?.click());
    await act(async () => buttonNamed("Send reminder")?.click());
    await settle();

    expect(fetch).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(bulkReminderRecoveryStorageKey(eventId))).toBeNull();
    expect(buttonNamed("Send reminder")).toBeDefined();
    expect(toastMock).toHaveBeenCalledWith(
      `Send reminders to up to ${BULK_REMINDER_TARGET_LIMIT} assignments at a time. Your selection is still available.`,
      { kind: "error" },
    );
  });

  it("clears the exact selection once before a remotely acknowledged attempt unlocks", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new TypeError("response lost"));

    await act(async () => root.render(<FilesAdminView
      eventId={eventId}
      rows={[row]}
      counts={{ all: 1, open: 1, overdue: 0, completed: 0 }}
      state="all"
      taskId=""
      fileRequestId=""
      hasUpload=""
      search=""
      fileRequests={[]}
      tasks={[]}
    />));
    await act(async () => buttonNamed("Select Ada")?.click());
    await act(async () => buttonNamed("Send reminder")?.click());
    await settle();

    const key = bulkReminderRecoveryStorageKey(eventId);
    const unresolvedValue = window.localStorage.getItem(key);
    expect(unresolvedValue).not.toBeNull();
    const resolvedValue = JSON.stringify({
      ...JSON.parse(unresolvedValue as string) as object,
      resolution: { kind: "result", result },
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

    expect(buttonNamed("Send reminder")).toBeUndefined();
    expect(buttonNamed("Retry reminders")).toBeUndefined();
    expect(toastMock.mock.calls.filter(([message]) => message === "Reminder status: 1 queued")).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new StorageEvent("storage", {
        key,
        oldValue: resolvedValue,
        newValue: null,
        storageArea: window.localStorage,
      }));
    });
    await settle();

    expect(buttonNamed("Send reminder")).toBeUndefined();
    expect(toastMock.mock.calls.filter(([message]) => message === "Reminder status: 1 queued")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
