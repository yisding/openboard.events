/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contactIdSchema, eventIdSchema, submissionIdSchema, taskIdSchema } from "@/shared/contracts";
import { SendReminderDialog } from "./send-reminder-dialog";

const sendMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());

const taskId = taskIdSchema.parse("e0000000-0000-4000-8000-000000000001");
const eventId = eventIdSchema.parse("e0000000-0000-4000-8000-000000000002");
const contactId = contactIdSchema.parse("e0000000-0000-4000-8000-000000000003");
const submissionId = submissionIdSchema.parse("e0000000-0000-4000-8000-000000000004");
const assignment = {
  taskId,
  taskName: "Upload your headshot",
  dueAt: "2026-09-01T12:00:00.000Z",
  submissionId,
  submissionCode: "CFP-1042",
};

vi.mock("../hooks/use-send-reminder", () => ({
  useOpenAssignments: () => ({ isLoading: false, isError: false, data: [assignment] }),
  useSendReminderNow: () => ({ isPending: false, mutateAsync: sendMock }),
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => button.textContent?.trim() === name)
    .at(-1);
}

async function settle() {
  await act(async () => {
    for (let step = 0; step < 8; step += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  sendMock.mockReset();
  toastMock.mockReset();
  closeMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("targeted reminder recovery", () => {
  it("retries one frozen attempt after a lost response and acknowledges it once", async () => {
    sendMock
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValue({ enqueued: true });

    await act(async () => root.render(
      <SendReminderDialog eventId={eventId} contactId={contactId} contactName="Nadia Lee" onClose={closeMock} />,
    ));
    await act(async () => buttonNamed("Send reminder")?.click());
    await act(async () => buttonNamed("Send reminder")?.click());
    await settle();

    expect(sendMock).toHaveBeenCalledOnce();
    const firstPayload = sendMock.mock.calls[0]?.[0];
    expect(firstPayload).toEqual({
      taskId,
      contactId,
      submissionId,
      attemptId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });
    expect(container.textContent).toContain("The outcome is unknown");
    expect(buttonNamed("Retry reminder")).toBeDefined();
    expect(buttonNamed("Cancel")?.disabled).toBe(true);
    const recoveryDialog = [...container.querySelectorAll<HTMLDialogElement>("dialog")]
      .find((dialog) => dialog.getAttribute("aria-label") === 'Send "Upload your headshot" now?');
    expect(recoveryDialog?.querySelector('button[aria-label="Close"]')).toBeNull();
    await act(async () => recoveryDialog?.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true })));
    expect(buttonNamed("Retry reminder")).toBeDefined();
    expect(closeMock).not.toHaveBeenCalled();

    await act(async () => buttonNamed("Retry reminder")?.click());
    await settle();

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[1]?.[0]).toEqual(firstPayload);
    expect(buttonNamed("Retry reminder")).toBeUndefined();
    expect(buttonNamed("Sent")).toBeDefined();
    expect(toastMock.mock.calls.filter(([message]) => message === "Reminder queued — it will arrive in about a second"))
      .toHaveLength(1);

    // Clicking again is a deliberate new confirmation, not a replay of the
    // acknowledged attempt, so it receives a fresh identity.
    await act(async () => buttonNamed("Sent")?.click());
    await act(async () => buttonNamed("Send reminder")?.click());
    await settle();
    expect(sendMock).toHaveBeenCalledTimes(3);
    expect(sendMock.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ taskId, contactId, submissionId }));
    expect(sendMock.mock.calls[2]?.[0].attemptId).not.toBe(firstPayload.attemptId);
  });
});
