import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "@/shared/ui/toast";
import type { BulkReminderRecoveryController } from "@/features/comms/index.client";
import type { AdminTaskDTO } from "../server/queries";
import { TaskMatrixDrawer } from "./task-matrix-drawer";

function withToast(element: React.ReactElement) {
  return React.createElement(ToastProvider, null, element);
}

Object.assign(globalThis, { React });

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
  recovery: null,
  sending: false,
  unreadable: false,
  start: async () => true,
  retry: async () => undefined,
  finishCleanup: () => undefined,
  clearUnreadable: () => undefined,
};

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
});
