/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventIdSchema } from "@/shared/contracts";
import { bulkSendPreviewFingerprint } from "../bulk-send-attempt";
import {
  BULK_SEND_RECOVERY_VERSION,
  bulkSendRecoveryStorageKey,
  loadBulkSendRecovery,
  persistBulkSendRecovery,
  speakerBulkSendRecoveryIdentity,
  type BulkSendRecoverySnapshot,
} from "../bulk-send-recovery";
import { BulkSendTab } from "./bulk-send-tab";

const composeMock = vi.hoisted(() => vi.fn());
const resolveMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../hooks/use-bulk-send", async (importOriginal) => {
  const original = await importOriginal<typeof import("../hooks/use-bulk-send")>();
  return {
    ...original,
    useComposeBulkSpeakerEmail: () => ({ mutateAsync: composeMock, isPending: false }),
    useResolveSpeakerSegment: () => ({ mutateAsync: resolveMock, isPending: false }),
  };
});
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = eventIdSchema.parse("b2000000-0000-4000-8000-000000000001");
const contactId = "b1000000-0000-4000-8000-000000000001";
let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function completedRecovery(): BulkSendRecoverySnapshot {
  const subject = "Program update";
  const bodyHtml = "<p>Hello speakers</p>";
  return {
    version: BULK_SEND_RECOVERY_VERSION,
    surface: "speaker",
    scope: eventId,
    recipients: [{ id: contactId, name: "Alex Speaker", email: "alex@example.com" }],
    previewRecipients: [{ id: contactId, name: "Alex Speaker", email: "alex@example.com" }],
    subject,
    bodyHtml,
    previewRecipientId: contactId,
    approvedPreview: {
      recipientEmail: "alex@example.com",
      recipientName: "Alex Speaker",
      subject: "Program update",
      bodyHtml: "<p>Hello Alex Speaker</p>",
      bodyText: "Hello Alex Speaker",
    },
    sendId: "b3000000-0000-4000-8000-000000000001",
    attemptStorageKey: "openboard:bulk-send:speaker-segment:approved-fingerprint",
    fingerprint: bulkSendPreviewFingerprint({
      contactIds: [contactId],
      previewContactId: contactId,
      subject,
      bodyHtml,
    }),
    completedResults: [{ queued: 1, alreadyQueued: 0, skipped: 0, errors: [] }],
    confirmedResult: { queued: 1, alreadyQueued: 0, skipped: 0, errors: [] },
  };
}

beforeEach(() => {
  composeMock.mockReset();
  resolveMock.mockReset();
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

describe("segment bulk email recovery", () => {
  it("finalizes a restored completed send when its recovery record is cleared", async () => {
    const snapshot = completedRecovery();
    expect(persistBulkSendRecovery(window.localStorage, snapshot).ok).toBe(true);

    await act(async () => root.render(<BulkSendTab eventId={eventId} />));
    expect(container.textContent).toContain("Send confirmed; cleanup needed");
    expect(buttonNamed("Clear completed recovery")).toBeDefined();

    await act(async () => buttonNamed("Clear completed recovery")?.click());

    expect(loadBulkSendRecovery(window.localStorage, snapshot)).toEqual({ ok: false, reason: "missing" });
    expect(container.textContent).not.toContain("Send confirmed; cleanup needed");
    expect(container.textContent).not.toContain("1 recipient will be emailed");
    expect(buttonNamed("Preview audience")?.disabled).toBe(false);
    expect(buttonNamed("Preview message")?.disabled).toBe(true);
    expect(composeMock).not.toHaveBeenCalled();
  });

  it("surfaces and explicitly clears an unreadable recovery before allowing another send", async () => {
    const identity = speakerBulkSendRecoveryIdentity(eventId);
    const storageKey = bulkSendRecoveryStorageKey(identity);
    window.localStorage.setItem(storageKey, JSON.stringify({ version: 0, old: "recovery" }));

    await act(async () => root.render(<BulkSendTab eventId={eventId} />));

    expect(container.textContent).toContain("Saved email recovery can’t be read");
    expect(buttonNamed("Preview audience")?.disabled).toBe(true);
    await act(async () => buttonNamed("Clear unreadable recovery")?.click());
    expect(container.textContent).toContain("Clear unreadable email recovery?");
    expect(window.localStorage.getItem(storageKey)).not.toBeNull();

    await act(async () => buttonNamed("Clear recovery")?.click());

    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(container.textContent).not.toContain("Saved email recovery can’t be read");
    expect(buttonNamed("Preview audience")?.disabled).toBe(false);
    expect(composeMock).not.toHaveBeenCalled();
  });

  it("does not clear unreadable recovery while another tab owns its lock", async () => {
    const identity = speakerBulkSendRecoveryIdentity(eventId);
    const storageKey = bulkSendRecoveryStorageKey(identity);
    window.localStorage.setItem(storageKey, JSON.stringify({ version: 0, old: "recovery" }));
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: async (_name: string, _options: unknown, callback: (lock: null) => unknown) => callback(null) },
    });

    await act(async () => root.render(<BulkSendTab eventId={eventId} />));
    await act(async () => buttonNamed("Clear unreadable recovery")?.click());
    await act(async () => buttonNamed("Clear recovery")?.click());

    expect(window.localStorage.getItem(storageKey)).not.toBeNull();
    expect(container.textContent).toContain("Saved email recovery can’t be read");
    expect(toastMock).toHaveBeenCalledWith(
      "Another tab is using this email recovery. Finish there before clearing it.",
      { kind: "error" },
    );
  });

  it("keeps a generic recovery with an invalid speaker audience explicitly abandonable", async () => {
    const snapshot = completedRecovery();
    const invalidContactId = "legacy-contact-id";
    const subject = snapshot.subject;
    const bodyHtml = snapshot.bodyHtml;
    const genericOnly: BulkSendRecoverySnapshot = {
      ...snapshot,
      recipients: [{ id: invalidContactId, name: "Legacy Speaker", email: "legacy@example.com" }],
      previewRecipients: [{ id: invalidContactId, name: "Legacy Speaker", email: "legacy@example.com" }],
      previewRecipientId: invalidContactId,
      fingerprint: bulkSendPreviewFingerprint({
        contactIds: [invalidContactId],
        previewContactId: invalidContactId,
        subject,
        bodyHtml,
      }),
    };
    expect(persistBulkSendRecovery(window.localStorage, genericOnly).ok).toBe(true);

    await act(async () => root.render(<BulkSendTab eventId={eventId} />));

    expect(container.textContent).toContain("Send confirmed; cleanup needed");
    expect(container.textContent).not.toContain("Saved email recovery can’t be read");
    expect(buttonNamed("Preview audience")?.disabled).toBe(true);
    expect(buttonNamed("Clear completed recovery")).toBeDefined();
    expect(composeMock).not.toHaveBeenCalled();
  });

  it("resets a restored audience when another tab clears shared recovery", async () => {
    const snapshot = completedRecovery();
    const storageKey = bulkSendRecoveryStorageKey(snapshot);
    expect(persistBulkSendRecovery(window.localStorage, snapshot).ok).toBe(true);
    await act(async () => root.render(<BulkSendTab eventId={eventId} />));
    expect(container.textContent).toContain("Send confirmed; cleanup needed");
    expect(container.textContent).toContain("1 recipient will be emailed");

    const oldValue = window.localStorage.getItem(storageKey);
    window.localStorage.removeItem(storageKey);
    await act(async () => window.dispatchEvent(new StorageEvent("storage", {
      key: storageKey,
      oldValue,
      newValue: null,
      storageArea: window.localStorage,
    })));

    expect(container.textContent).not.toContain("Send confirmed; cleanup needed");
    expect(container.textContent).not.toContain("1 recipient will be emailed");
    expect(buttonNamed("Preview audience")?.disabled).toBe(false);
    expect(buttonNamed("Preview message")?.disabled).toBe(true);
  });
});
