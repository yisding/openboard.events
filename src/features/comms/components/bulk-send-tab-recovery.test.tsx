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
    scope: `segment:${eventId}`,
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
    expect(persistBulkSendRecovery(window.sessionStorage, snapshot).ok).toBe(true);

    await act(async () => root.render(<BulkSendTab eventId={eventId} />));
    expect(container.textContent).toContain("Send confirmed; cleanup needed");
    expect(buttonNamed("Clear completed recovery")).toBeDefined();

    await act(async () => buttonNamed("Clear completed recovery")?.click());

    expect(loadBulkSendRecovery(window.sessionStorage, snapshot)).toEqual({ ok: false, reason: "missing" });
    expect(container.textContent).not.toContain("Send confirmed; cleanup needed");
    expect(buttonNamed("Send to 1 recipient")?.disabled).toBe(true);
    expect(buttonNamed("Preview message")?.disabled).toBe(false);
    expect(composeMock).not.toHaveBeenCalled();
  });

  it("surfaces and explicitly clears an unreadable recovery before allowing another send", async () => {
    const identity = { surface: "speaker" as const, scope: `segment:${eventId}` };
    const storageKey = bulkSendRecoveryStorageKey(identity);
    window.sessionStorage.setItem(storageKey, JSON.stringify({ version: 0, old: "recovery" }));

    await act(async () => root.render(<BulkSendTab eventId={eventId} />));

    expect(container.textContent).toContain("Saved email recovery can’t be read");
    expect(buttonNamed("Preview audience")?.disabled).toBe(true);
    await act(async () => buttonNamed("Clear unreadable recovery")?.click());
    expect(container.textContent).toContain("Clear unreadable email recovery?");
    expect(window.sessionStorage.getItem(storageKey)).not.toBeNull();

    await act(async () => buttonNamed("Clear recovery")?.click());

    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    expect(container.textContent).not.toContain("Saved email recovery can’t be read");
    expect(buttonNamed("Preview audience")?.disabled).toBe(false);
    expect(composeMock).not.toHaveBeenCalled();
  });
});
