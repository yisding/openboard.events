/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BULK_SEND_RECOVERY_VERSION,
  bulkSendRecoveryStorageKey,
  loadBulkSendRecovery,
  persistBulkSendRecovery,
  type BulkSendRecoverySnapshot,
} from "@/features/comms/index.bulk-send-recovery";
import { bulkSendPreviewFingerprint } from "@/features/comms/index.bulk-send-attempt";
import { organizationIdSchema } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { CrmBulkEmailDialog } from "./crm-bulk-email-dialog";

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = organizationIdSchema.parse("b2000000-0000-4000-8000-000000000001");
const recipients = Array.from({ length: 501 }, (_, index) => {
  const suffix = String(index + 1).padStart(12, "0");
  return { id: `b1000000-0000-4000-8000-${suffix}`, name: `Contact ${index + 1}`, email: `contact-${index + 1}@example.com` };
});

function recovery(): BulkSendRecoverySnapshot {
  const subject = "CRM update";
  const bodyHtml = "<p>Hello</p>";
  const previewRecipient = recipients[0];
  if (!previewRecipient) throw new Error("Recovery fixture needs a preview recipient");
  const previewRecipientId = previewRecipient.id;
  return {
    version: BULK_SEND_RECOVERY_VERSION,
    surface: "crm",
    scope: organizationId,
    recipients,
    previewRecipients: [previewRecipient],
    subject,
    bodyHtml,
    previewRecipientId,
    approvedPreview: {
      recipientEmail: previewRecipient.email,
      recipientName: previewRecipient.name,
      subject,
      bodyHtml,
      bodyText: "Hello",
    },
    sendId: "b3000000-0000-4000-8000-000000000001",
    attemptStorageKey: "openboard:bulk-send:crm:test-hash",
    fingerprint: bulkSendPreviewFingerprint({ contactIds: recipients.map((row) => row.id), previewContactId: previewRecipientId, subject, bodyHtml }),
    completedResults: [],
    confirmedResult: null,
  };
}

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => button.textContent?.trim() === name);
}

async function waitForEnabledButton(name: string) {
  await vi.waitFor(async () => {
    await act(async () => { await Promise.resolve(); });
    const button = buttonsNamed(name)[0];
    if (!button || button.disabled) throw new Error(`${name} is not enabled yet`);
  }, { timeout: 5_000 });
}

async function change(control: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(control, value);
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  apiMock.mockReset();
  toastMock.mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: { request: async (_name: string, _options: unknown, callback: (lock: object) => unknown) => callback({}) },
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
});

describe("CRM partial-batch recovery", () => {
  it("keeps a first structured send failure recoverable because one request can commit multiple event groups", async () => {
    const recipient = recipients[0];
    if (!recipient) throw new Error("Recovery fixture needs a recipient");
    const preview = {
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      subject: "CRM update",
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
    };
    apiMock
      .mockResolvedValueOnce({ queued: 0, alreadyQueued: 0, skipped: 0, errors: [], preview })
      .mockRejectedValueOnce(new AppError("NOT_FOUND", "A later event was removed"));
    await act(async () => root.render(<CrmBulkEmailDialog
      organizationId={organizationId}
      open
      recipients={[recipient]}
      onClose={vi.fn()}
    />));

    const subject = container.querySelector<HTMLInputElement>('input[placeholder="A note for you"]');
    const body = container.querySelector<HTMLTextAreaElement>("textarea");
    if (!subject || !body) throw new Error("Compose fields were not rendered");
    await change(subject, "CRM update");
    await change(body, "<p>Hello</p>");
    await act(async () => {
      buttonNamed("Refresh preview")?.click();
    });
    await waitForEnabledButton("Send to 1");
    await act(async () => buttonsNamed("Send to 1")[0]?.click());
    expect(container.textContent).toContain("Send this message to 1 contact?");
    await act(async () => buttonsNamed("Send to 1").at(-1)?.click());

    expect(container.textContent).toContain("couldn’t confirm whether every email was queued");
    expect(buttonNamed("Retry this send")).toBeDefined();
    expect(loadBulkSendRecovery(window.localStorage, { surface: "crm", scope: organizationId })).toMatchObject({
      ok: true,
      snapshot: { subject: "CRM update" },
    });
    expect(window.sessionStorage.getItem(bulkSendRecoveryStorageKey({ surface: "crm", scope: organizationId }))).toBeNull();
  });

  it("retries every batch with one send id and reports prior recipients as recovered", async () => {
    const snapshot = recovery();
    expect(persistBulkSendRecovery(window.localStorage, snapshot).ok).toBe(true);
    apiMock
      .mockResolvedValueOnce({ queued: 500, alreadyQueued: 0, skipped: 0, errors: [], preview: null })
      .mockRejectedValueOnce(new TypeError("connection dropped"));
    await act(async () => root.render(<CrmBulkEmailDialog
      organizationId={organizationId}
      open
      recipients={[]}
      initialRecovery={snapshot}
      onClose={vi.fn()}
    />));

    await act(async () => buttonNamed("Retry this send")?.click());
    expect(apiMock).toHaveBeenCalledTimes(2);
    expect(apiMock.mock.calls[0]?.[2].body.sendId).toBe(snapshot.sendId);
    expect(apiMock.mock.calls[1]?.[2].body.sendId).toBe(snapshot.sendId);
    expect(container.textContent).toContain("couldn’t confirm whether every email was queued");

    apiMock
      .mockResolvedValueOnce({ queued: 0, alreadyQueued: 500, skipped: 0, errors: [], preview: null })
      .mockResolvedValueOnce({ queued: 1, alreadyQueued: 0, skipped: 0, errors: [], preview: null });
    const removeItem = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    await act(async () => buttonNamed("Retry this send")?.click());

    expect(apiMock).toHaveBeenCalledTimes(4);
    expect(apiMock.mock.calls.slice(2).every((call) => call[2].body.sendId === snapshot.sendId)).toBe(true);
    expect(container.textContent).toContain("501 accepted");
    expect(container.textContent).toContain("500 already queued by this attempt");
    expect(loadBulkSendRecovery(window.localStorage, { surface: "crm", scope: organizationId })).toMatchObject({
      ok: true,
      snapshot: {
        completedResults: [
          { queued: 0, alreadyQueued: 500, skipped: 0, errors: [] },
          { queued: 1, alreadyQueued: 0, skipped: 0, errors: [] },
        ],
      },
    });

    removeItem.mockRestore();
    await act(async () => buttonNamed("Clear completed recovery")?.click());
    expect(loadBulkSendRecovery(window.localStorage, { surface: "crm", scope: organizationId }))
      .toEqual({ ok: false, reason: "missing" });
  });

  it("restores a confirmed receipt for cleanup without sending again", async () => {
    const snapshot: BulkSendRecoverySnapshot = {
      ...recovery(),
      confirmedResult: { queued: 0, alreadyQueued: 501, skipped: 0, errors: [] },
    };
    expect(persistBulkSendRecovery(window.localStorage, snapshot).ok).toBe(true);
    function Harness() {
      const [saved, setSaved] = React.useState<BulkSendRecoverySnapshot | null>(snapshot);
      return <CrmBulkEmailDialog
        organizationId={organizationId}
        open
        recipients={[]}
        initialRecovery={saved}
        onRecoveryChange={setSaved}
        onClose={vi.fn()}
      />;
    }
    await act(async () => root.render(<Harness />));

    expect(container.textContent).toContain("501 accepted");
    expect(container.textContent).toContain("Email 501 contacts");
    expect(buttonNamed("Retry this send")).toBeUndefined();
    await act(async () => buttonNamed("Clear completed recovery")?.click());

    expect(apiMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Email 501 contacts");
    expect(loadBulkSendRecovery(window.localStorage, { surface: "crm", scope: organizationId }))
      .toEqual({ ok: false, reason: "missing" });
  });

  it("keeps a confirmed result active when its receipt cannot be persisted", async () => {
    const snapshot = recovery();
    expect(persistBulkSendRecovery(window.localStorage, snapshot).ok).toBe(true);
    let restoreSetItem = () => {};
    apiMock
      .mockResolvedValueOnce({ queued: 0, alreadyQueued: 500, skipped: 0, errors: [], preview: null })
      .mockImplementationOnce(async () => {
        const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
        restoreSetItem = () => setItem.mockRestore();
        return { queued: 0, alreadyQueued: 1, skipped: 0, errors: [], preview: null };
      });
    await act(async () => root.render(<CrmBulkEmailDialog
      organizationId={organizationId}
      open
      recipients={[]}
      initialRecovery={snapshot}
      onClose={vi.fn()}
    />));

    await act(async () => buttonNamed("Retry this send")?.click());

    expect(container.textContent).toContain("501 accepted");
    expect(container.textContent).toContain("receipt could not be saved");
    expect(buttonNamed("Clear completed recovery")).toBeDefined();
    expect(loadBulkSendRecovery(window.localStorage, { surface: "crm", scope: organizationId })).toMatchObject({
      ok: true,
      snapshot: { confirmedResult: null },
    });
    restoreSetItem();
  });
});

describe("CRM segment cap", () => {
  it("refuses to send a truncated audience instead of quietly emailing the first 2,000", async () => {
    // `resolveCrmSegmentIn` caps ids at MAX_SEGMENT_RECIPIENTS and reports
    // `capped`. The dialog used to hardcode `capped: false`, so a 2,500-contact
    // segment sent to the first 2,000 and reported success — the other 500
    // appeared in no error list, no skip count and no failure state.
    // `canSendBulkMessage` exists to block exactly that, and the comms surface
    // has always passed the real value.
    const recipient = { id: "d1000000-0000-4000-8000-000000000001", name: "Ada", email: "ada@example.com" };
    const preview = {
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      subject: "CRM update",
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
    };
    apiMock.mockResolvedValue({ queued: 0, alreadyQueued: 0, skipped: 0, errors: [], preview });
    await act(async () => root.render(<CrmBulkEmailDialog
      organizationId={organizationId}
      open
      recipients={[recipient]}
      capped
      onClose={vi.fn()}
    />));

    const subject = container.querySelector<HTMLInputElement>('input[placeholder="A note for you"]');
    const body = container.querySelector<HTMLTextAreaElement>("textarea");
    if (!subject || !body) throw new Error("Compose fields were not rendered");
    await change(subject, "CRM update");
    await change(body, "<p>Hello</p>");
    await act(async () => { buttonNamed("Refresh preview")?.click(); });

    // Even with a current preview, Send stays disabled while the audience is
    // truncated — the same gate `bulk-send-tab` applies.
    expect(buttonNamed("Send to 1")?.disabled).toBe(true);
  });

  it("still sends a segment that resolved in full", async () => {
    const recipient = { id: "d1000000-0000-4000-8000-000000000002", name: "Grace", email: "grace@example.com" };
    const preview = {
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      subject: "CRM update",
      bodyHtml: "<p>Hello</p>",
      bodyText: "Hello",
    };
    apiMock.mockResolvedValue({ queued: 0, alreadyQueued: 0, skipped: 0, errors: [], preview });
    await act(async () => root.render(<CrmBulkEmailDialog
      organizationId={organizationId}
      open
      recipients={[recipient]}
      onClose={vi.fn()}
    />));

    const subject = container.querySelector<HTMLInputElement>('input[placeholder="A note for you"]');
    const body = container.querySelector<HTMLTextAreaElement>("textarea");
    if (!subject || !body) throw new Error("Compose fields were not rendered");
    await change(subject, "CRM update");
    await change(body, "<p>Hello</p>");
    await act(async () => { buttonNamed("Refresh preview")?.click(); });
    await waitForEnabledButton("Send to 1");
    expect(buttonNamed("Send to 1")?.disabled).toBe(false);
  });
});
