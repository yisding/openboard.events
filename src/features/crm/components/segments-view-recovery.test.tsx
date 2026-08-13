/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BULK_SEND_RECOVERY_VERSION,
  persistBulkSendRecovery,
  type BulkSendRecoverySnapshot,
} from "@/features/comms/bulk-send-recovery";
import { bulkSendPreviewFingerprint } from "@/features/comms/bulk-send-attempt";
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

async function renderView() {
  await act(async () => {
    root.render(<SegmentsView organizationId={organizationId} initialSegments={[segment]} tags={[]} events={[]} />);
    await Promise.resolve();
  });
}

beforeEach(() => {
  apiMock.mockReset();
  window.sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("CRM segment send recovery", () => {
  it("blocks a new segment send while an unconfirmed organization send exists", async () => {
    expect(persistBulkSendRecovery(window.sessionStorage, recovery()).ok).toBe(true);
    await renderView();

    expect(container.textContent).toContain("Unconfirmed CRM email");
    expect(emailButton()?.disabled).toBe(true);
    emailButton()?.click();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("rechecks storage before resolving a segment so another tab cannot be overwritten", async () => {
    await renderView();
    expect(emailButton()?.disabled).toBe(false);
    expect(persistBulkSendRecovery(window.sessionStorage, recovery()).ok).toBe(true);

    await act(async () => emailButton()?.click());

    expect(apiMock).not.toHaveBeenCalled();
    expect(emailButton()?.disabled).toBe(true);
  });
});
