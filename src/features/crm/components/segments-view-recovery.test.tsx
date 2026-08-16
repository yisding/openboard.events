/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BULK_SEND_RECOVERY_VERSION,
  bulkSendRecoveryStorageKey,
  persistBulkSendRecovery,
  type BulkSendRecoverySnapshot,
} from "@/features/comms/index.bulk-send-recovery";
import { bulkSendPreviewFingerprint } from "@/features/comms/index.bulk-send-attempt";
import {
  crmSegmentDtoSchema,
  organizationContactIdSchema,
  organizationIdSchema,
} from "@/shared/contracts";
import { SegmentsView } from "./segments-view";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("./crm-nav", () => ({ CrmNav: () => null }));
vi.mock("./crm-bulk-email-dialog", () => ({ CrmBulkEmailDialog: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = organizationIdSchema.parse("b2000000-0000-4000-8000-000000000001");
const contactId = organizationContactIdSchema.parse("b1000000-0000-4000-8000-000000000001");
const segment = crmSegmentDtoSchema.parse({
  id: "b3000000-0000-4000-8000-000000000001",
  name: "Returning speakers",
  filter: {},
  createdAt: "2026-08-13T18:00:00.000Z",
  updatedAt: "2026-08-13T18:00:00.000Z",
});

function recovery(): BulkSendRecoverySnapshot {
  const subject = "Program update";
  const bodyHtml = "<p>Hello</p>";
  return {
    version: BULK_SEND_RECOVERY_VERSION,
    surface: "crm",
    scope: organizationId,
    recipients: [{ id: contactId, name: "Alex Speaker", email: "alex@example.com" }],
    previewRecipients: [{ id: contactId, name: "Alex Speaker", email: "alex@example.com" }],
    subject,
    bodyHtml,
    previewRecipientId: contactId,
    approvedPreview: {
      recipientEmail: "alex@example.com",
      recipientName: "Alex Speaker",
      subject,
      bodyHtml,
      bodyText: "Hello",
    },
    sendId: "b4000000-0000-4000-8000-000000000001",
    attemptStorageKey: "openboard:bulk-send:crm:test-hash",
    fingerprint: bulkSendPreviewFingerprint({ contactIds: [contactId], previewContactId: contactId, subject, bodyHtml }),
    completedResults: [],
    confirmedResult: null,
  };
}

let container: HTMLDivElement;
let root: Root;

function emailButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes("Email segment"));
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

async function renderView() {
  await act(async () => {
    root.render(<SegmentsView organizationId={organizationId} initialSegments={[segment]} tags={[]} events={[]} customFields={[]} />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  apiMock.mockReset();
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

describe("CRM segment send recovery", () => {
  it("blocks a new segment send while an unconfirmed organization send exists", async () => {
    expect(persistBulkSendRecovery(window.localStorage, recovery()).ok).toBe(true);
    await renderView();

    expect(container.textContent).toContain("Unconfirmed CRM email");
    expect(emailButton()?.disabled).toBe(true);
    emailButton()?.click();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("rechecks storage before resolving a segment so another tab cannot be overwritten", async () => {
    await renderView();
    expect(emailButton()?.disabled).toBe(false);
    expect(persistBulkSendRecovery(window.localStorage, recovery()).ok).toBe(true);

    await act(async () => emailButton()?.click());

    expect(apiMock).not.toHaveBeenCalled();
    expect(emailButton()?.disabled).toBe(true);
  });

  it("blocks on old unreadable recovery and unlocks only after confirmed cleanup", async () => {
    const identity = { surface: "crm" as const, scope: organizationId };
    const storageKey = bulkSendRecoveryStorageKey(identity);
    window.localStorage.setItem(storageKey, JSON.stringify({ version: 0, old: "recovery" }));
    await renderView();

    expect(container.textContent).toContain("Saved email recovery can’t be read");
    expect(emailButton()?.disabled).toBe(true);
    await act(async () => buttonNamed("Clear unreadable recovery")?.click());
    expect(window.localStorage.getItem(storageKey)).not.toBeNull();
    await act(async () => buttonNamed("Clear recovery")?.click());

    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(container.textContent).not.toContain("Saved email recovery can’t be read");
    expect(emailButton()?.disabled).toBe(false);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("drops its cached recovery when another tab clears shared storage", async () => {
    const identity = { surface: "crm" as const, scope: organizationId };
    const storageKey = bulkSendRecoveryStorageKey(identity);
    expect(persistBulkSendRecovery(window.localStorage, recovery()).ok).toBe(true);
    await renderView();
    expect(emailButton()?.disabled).toBe(true);

    const oldValue = window.localStorage.getItem(storageKey);
    window.localStorage.removeItem(storageKey);
    await act(async () => window.dispatchEvent(new StorageEvent("storage", {
      key: storageKey,
      oldValue,
      newValue: null,
      storageArea: window.localStorage,
    })));

    expect(container.textContent).not.toContain("Unconfirmed CRM email");
    expect(emailButton()?.disabled).toBe(false);
  });
});
