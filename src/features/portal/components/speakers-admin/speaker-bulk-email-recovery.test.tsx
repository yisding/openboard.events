/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bulkSendPreviewFingerprint,
  claimBulkSendAttempt,
  completeBulkSendAttempt,
} from "@/features/comms/bulk-send-attempt";
import {
  bulkSendAttemptScope,
  loadBulkSendRecovery,
  speakerBulkSendRecoveryIdentity,
} from "@/features/comms/bulk-send-recovery";
import { AppError } from "@/shared/lib/errors";
import { SpeakerBulkEmailDialog } from "./speaker-bulk-email-dialog";

const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/shared/lib/api-client", () => ({ api: apiMock }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = "b2000000-0000-4000-8000-000000000001";
const contactId = "b1000000-0000-4000-8000-000000000001";
const selected = [{ contactId, name: "Alex Speaker", email: "alex@example.com" }];

let container: HTMLDivElement;
let root: Root;

function buttonsNamed(name: string): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .filter((button) => button.textContent?.trim() === name);
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

describe("targeted speaker email recovery", () => {
  it("rejects a stale approved preview after another tab completes and a new generation starts", async () => {
    const recoveryIdentity = speakerBulkSendRecoveryIdentity(eventId);
    const subjectText = "Program update";
    const bodyHtml = "<p>Hello</p>";
    const fingerprint = bulkSendPreviewFingerprint({
      contactIds: [contactId],
      previewContactId: contactId,
      subject: subjectText,
      bodyHtml,
    });
    const sharedAttempt = await claimBulkSendAttempt(
      window.localStorage,
      bulkSendAttemptScope(recoveryIdentity),
      fingerprint,
      () => "b3000000-0000-4000-8000-000000000099",
    );
    apiMock
      .mockResolvedValueOnce({
        queued: 0,
        alreadyQueued: 0,
        skipped: 0,
        errors: [],
        preview: {
          recipientEmail: "alex@example.com",
          recipientName: "Alex Speaker",
          subject: subjectText,
          bodyHtml: "<p>Hello Alex</p>",
          bodyText: "Hello Alex",
        },
      });

    await act(async () => root.render(<SpeakerBulkEmailDialog eventId={eventId} open selected={selected} onClose={vi.fn()} />));
    const subject = container.querySelector<HTMLInputElement>('input[placeholder^="A note"]');
    const body = container.querySelector<HTMLTextAreaElement>("textarea");
    if (!subject || !body) throw new Error("Compose fields were not rendered");
    await change(subject, subjectText);
    await change(body, bodyHtml);
    await act(async () => {
      buttonsNamed("Refresh preview")[0]?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The other tab completes X and a later intentional preview advances the
    // exact fingerprint to Y. This stale X preview must not resurrect itself.
    completeBulkSendAttempt(window.localStorage, sharedAttempt);
    const nextAttempt = await claimBulkSendAttempt(
      window.localStorage,
      bulkSendAttemptScope(recoveryIdentity),
      fingerprint,
      () => "b3000000-0000-4000-8000-000000000100",
    );
    expect(nextAttempt.sendId).not.toBe(sharedAttempt.sendId);
    await act(async () => buttonsNamed("Send to 1")[0]?.click());
    await act(async () => buttonsNamed("Send to 1").at(-1)?.click());

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("approved preview was completed or replaced in another tab");
    expect(window.sessionStorage.length).toBe(0);
  });

  it("does not send when another tab owns the event-wide email lock", async () => {
    const preview = {
      recipientEmail: "alex@example.com",
      recipientName: "Alex Speaker",
      subject: "Program update",
      bodyHtml: "<p>Hello Alex</p>",
      bodyText: "Hello Alex",
    };
    apiMock.mockResolvedValueOnce({ queued: 0, alreadyQueued: 0, skipped: 0, errors: [], preview });
    await act(async () => root.render(<SpeakerBulkEmailDialog eventId={eventId} open selected={selected} onClose={vi.fn()} />));
    const subject = container.querySelector<HTMLInputElement>('input[placeholder^="A note"]');
    const body = container.querySelector<HTMLTextAreaElement>("textarea");
    if (!subject || !body) throw new Error("Compose fields were not rendered");
    await change(subject, "Program update");
    await change(body, "<p>Hello</p>");
    await act(async () => {
      buttonsNamed("Refresh preview")[0]?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: { request: async (_name: string, _options: unknown, callback: (lock: null) => unknown) => callback(null) },
    });

    await act(async () => buttonsNamed("Send to 1")[0]?.click());
    await act(async () => buttonsNamed("Send to 1").at(-1)?.click());

    expect(container.textContent).toContain("Another tab is already preparing or sending email for this event");
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(loadBulkSendRecovery(window.localStorage, speakerBulkSendRecoveryIdentity(eventId))).toEqual({ ok: false, reason: "missing" });
  });

  it("freezes an ambiguous send, persists it, and resumes with the same send id", async () => {
    const preview = {
      recipientEmail: "alex@example.com",
      recipientName: "Alex Speaker",
      subject: "Program update",
      bodyHtml: "<p>Hello Alex</p>",
      bodyText: "Hello Alex",
    };
    apiMock
      .mockResolvedValueOnce({ queued: 0, alreadyQueued: 0, skipped: 0, errors: [], preview })
      .mockRejectedValueOnce(new TypeError("connection dropped"));

    await act(async () => root.render(<SpeakerBulkEmailDialog eventId={eventId} open selected={selected} onClose={vi.fn()} />));
    const subject = container.querySelector<HTMLInputElement>('input[placeholder^="A note"]');
    const body = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(subject).not.toBeNull();
    expect(body).not.toBeNull();
    if (!subject || !body) throw new Error("Compose fields were not rendered");
    await change(subject, "Program update");
    await change(body, "<p>Hello {{event.name}}</p>");

    await act(async () => {
      buttonsNamed("Refresh preview")[0]?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(buttonsNamed("Send to 1")[0]?.disabled).toBe(false);
    await act(async () => buttonsNamed("Send to 1")[0]?.click());
    await act(async () => buttonsNamed("Send to 1").at(-1)?.click());

    expect(container.textContent).toContain("couldn’t confirm whether every email was queued");
    expect(container.textContent).not.toContain("Send this message to 1 speaker?");
    expect(subject?.disabled).toBe(true);
    expect(body?.disabled).toBe(true);
    expect(buttonsNamed("Retry this send")).toHaveLength(1);
    const recovered = loadBulkSendRecovery(window.localStorage, speakerBulkSendRecoveryIdentity(eventId));
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    const originalSendId = recovered.snapshot.sendId;

    apiMock.mockRejectedValueOnce(new AppError("FORBIDDEN", "Your access changed"));
    await act(async () => buttonsNamed("Retry this send")[0]?.click());
    expect(container.textContent).toContain("couldn’t confirm whether every email was queued");
    expect(loadBulkSendRecovery(window.localStorage, speakerBulkSendRecoveryIdentity(eventId))).toMatchObject({
      ok: true,
      snapshot: { sendId: originalSendId },
    });

    apiMock.mockResolvedValueOnce({ queued: 0, alreadyQueued: 1, skipped: 0, errors: [], preview: null });
    const removeItem = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => { throw new Error("blocked"); });
    await act(async () => buttonsNamed("Retry this send")[0]?.click());

    expect(apiMock).toHaveBeenLastCalledWith(
      `speakers/${eventId}/bulk-email`,
      expect.anything(),
      expect.objectContaining({ body: expect.objectContaining({ sendId: originalSendId, subject: "Program update" }) }),
    );
    expect(container.textContent).toContain("1 accepted");
    expect(container.textContent).toContain("send is confirmed, but browser recovery could not be cleared");
    expect(buttonsNamed("Clear completed recovery")).toHaveLength(1);
    expect(loadBulkSendRecovery(window.localStorage, speakerBulkSendRecoveryIdentity(eventId))).toMatchObject({
      ok: true,
      snapshot: { confirmedResult: { alreadyQueued: 1 } },
    });

    removeItem.mockRestore();
    await act(async () => buttonsNamed("Clear completed recovery")[0]?.click());
    expect(loadBulkSendRecovery(window.localStorage, speakerBulkSendRecoveryIdentity(eventId)))
      .toEqual({ ok: false, reason: "missing" });
  });

  it("requires explicit discard before closing a written draft", async () => {
    const close = vi.fn();
    await act(async () => root.render(<SpeakerBulkEmailDialog eventId={eventId} open selected={selected} onClose={close} />));
    const subject = container.querySelector<HTMLInputElement>('input[placeholder^="A note"]');
    if (!subject) throw new Error("Subject field was not rendered");
    await change(subject, "Keep this draft");

    await act(async () => buttonsNamed("Cancel")[0]?.click());
    expect(close).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Discard this bulk email draft?");
    await act(async () => buttonsNamed("Discard draft")[0]?.click());
    expect(close).toHaveBeenCalledOnce();
  });
});
