/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/shared/ui/toast";
import type { BulkReminderRecoveryController } from "@/features/comms/index.client";
import type { AdminTaskAssignmentDTO, AdminTaskDTO } from "../server/queries";
import { TaskMatrixDrawer } from "./task-matrix-drawer";
import { settle } from "@tests/support/react";

function withToast(element: React.ReactElement) {
  return React.createElement(ToastProvider, null, element);
}

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const TASK: AdminTaskDTO = {
  id: "a0000000-0000-4000-8000-000000000030" as AdminTaskDTO["id"],
  name: "Upload slides",
  descriptionHtml: "",
  targetType: "contact",
  completionMode: "manual",
  formId: null,
  fileRequestId: null,
  dueAt: null,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  counts: { completed: 1, open: 2, overdue: 1 },
};

const REMINDER_RECOVERY: BulkReminderRecoveryController = {
  blocked: false,
  confirmedButUnsynced: false,
  recovery: null,
  sending: false,
  unreadable: false,
  start: async () => true,
  retry: async () => undefined,
  finishCleanup: () => undefined,
  clearUnreadable: () => undefined,
};

const ASSIGNMENT: AdminTaskAssignmentDTO = {
  taskId: TASK.id,
  contactId: "a0000000-0000-4000-8000-000000000031" as AdminTaskAssignmentDTO["contactId"],
  submissionId: null,
  dueAt: null,
  completed: false,
  completedAt: null,
  completedVia: null,
  overdue: false,
  contactName: "Ada Lovelace",
  contactEmail: "ada@example.com",
  submissionCode: null,
  submissionTitle: null,
};

let container: HTMLDivElement;
let root: Root;


beforeEach(() => {
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

describe("TaskMatrixDrawer", () => {
  it("renders the loading state and the nav position before any fetch resolves", () => {
    const html = renderToStaticMarkup(withToast(React.createElement(TaskMatrixDrawer, {
      eventId: "a0000000-0000-4000-8000-000000000001",
      task: TASK,
      timezone: "America/Los_Angeles",
      onClose: () => {},
      reminderRecovery: REMINDER_RECOVERY,
      reminderAcknowledgement: 0,
      nav: { index: 1, total: 5, onPrev: () => {}, onNext: () => {} },
    })));

    expect(html).toContain("Upload slides");
    expect(html).toContain("Loading");
    expect(html).toContain("2 of 5");
    expect(html).toContain("<dialog");
    expect(html).toContain('aria-label="Upload slides"');
  });

  it("omits the nav controls when no nav is supplied", () => {
    const html = renderToStaticMarkup(withToast(React.createElement(TaskMatrixDrawer, {
      eventId: "a0000000-0000-4000-8000-000000000001",
      task: TASK,
      timezone: "America/Los_Angeles",
      onClose: () => {},
      reminderRecovery: REMINDER_RECOVERY,
      reminderAcknowledgement: 0,
    })));

    expect(html).not.toContain("flow-nav-controls");
  });

  it("sends selected exact assignments and clears them when page recovery acknowledges", async () => {
    const start = vi.fn(async () => true);
    const reminderRecovery = { ...REMINDER_RECOVERY, start };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { assignments: [ASSIGNMENT] } }),
    }));

    const renderDrawer = (reminderAcknowledgement: number) => root.render(withToast(<TaskMatrixDrawer
      eventId="a0000000-0000-4000-8000-000000000001"
      task={TASK}
      timezone="America/Los_Angeles"
      onClose={() => undefined}
      reminderRecovery={reminderRecovery}
      reminderAcknowledgement={reminderAcknowledgement}
    />));

    await act(async () => renderDrawer(0));
    await settle();
    const checkbox = container.querySelector<HTMLInputElement>('input[aria-label="Select Ada Lovelace"]');
    if (!checkbox) throw new Error("Missing Ada assignment checkbox");
    await act(async () => checkbox.click());
    const send = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Send reminder");
    if (!send) throw new Error("Missing reminder action");
    await act(async () => send.click());

    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith([{
      taskId: TASK.id,
      contactId: ASSIGNMENT.contactId,
      submissionId: null,
    }]);
    expect(checkbox.checked).toBe(true);

    await act(async () => renderDrawer(1));
    await settle();

    expect(container.querySelector<HTMLInputElement>('input[aria-label="Select Ada Lovelace"]')?.checked).toBe(false);
    expect(start).toHaveBeenCalledOnce();
  });
});
