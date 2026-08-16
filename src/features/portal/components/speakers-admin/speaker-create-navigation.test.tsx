/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeakersAdminView } from "./speakers-admin-view";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => navigation.params,
}));
vi.mock("@/features/comms/index.bulk-send-recovery", () => ({
  bulkSendRecoveryStorageKey: () => "speaker-email-recovery",
  loadBulkSendRecovery: () => ({ ok: true, snapshot: null }),
  speakerBulkSendRecoveryIdentity: () => ({ eventId: "event-1" }),
}));
vi.mock("@/features/comms/index.client", () => ({
  UnreadableBulkSendRecovery: () => null,
  BulkReminderRecoveryDialog: () => null,
  useBulkReminderRecovery: () => ({
    blocked: false,
    recovery: null,
    sending: false,
    unreadable: false,
    start: vi.fn(),
    retry: vi.fn(),
    finishCleanup: vi.fn(),
    clearUnreadable: vi.fn(),
  }),
}));
vi.mock("@/shared/ui/app/confirm-dialog", () => ({ ConfirmDialog: () => null }));
vi.mock("@/shared/ui/app/data-table", () => ({ DataTable: () => null }));
vi.mock("@/shared/ui/app/use-flow-keyboard-nav", () => ({ useFlowKeyboardNav: () => undefined }));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("./speaker-bulk-email-dialog", () => ({ SpeakerBulkEmailDialog: () => null }));
vi.mock("./speaker-flow-drawer", () => ({ SpeakerFlowDrawer: () => null }));
vi.mock("./speaker-import-dialog", () => ({ SpeakerImportDialog: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const eventId = "e5000000-0000-4000-8000-000000000001";
const contactId = "e5000000-0000-4000-8000-000000000002";

let container: HTMLDivElement;
let root: Root;

function buttonNamed(name: string, scope: ParentNode = container): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function dialogButtonNamed(name: string): HTMLButtonElement | undefined {
  const dialog = document.querySelector("dialog");
  if (!dialog) throw new Error("The Add speaker dialog was not rendered");
  return buttonNamed(name, dialog);
}

async function openCreateDialog() {
  await act(async () => root.render(
    <SpeakersAdminView
      eventId={eventId}
      timezone="America/Los_Angeles"
      rows={[]}
      total={0}
      filterCounts={{ all: 0, accepted: 0, missingBio: 0, missingHeadshot: 0, missingEither: 0 }}
      page={1}
      pageSize={25}
      q=""
      accepted={false}
      missing={null}
      confirmation={null}
      sort="name"
      dir="asc"
    />,
  ));
  await act(async () => buttonNamed("Add speaker")?.click());
}

beforeEach(() => {
  navigation.params = new URLSearchParams();
  navigation.push.mockReset();
  navigation.replace.mockReset();
  navigation.refresh.mockReset();
  toastMock.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
    // What a browser does on showModal(): focus the dialog's first focusable
    // element, which is the header Close button. This is what silently
    // overrode the field's `autoFocus`.
    this.querySelector<HTMLElement>("button, input")?.focus();
  };
  HTMLDialogElement.prototype.close = function close() { this.open = false; };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Add speaker", () => {
  it("opens with the cursor in the first field rather than on Close", async () => {
    await openCreateDialog();

    const email = document.querySelector<HTMLInputElement>('dialog input[type="email"]');
    expect(email).not.toBeNull();
    expect(document.activeElement).toBe(email);
  });

  it("completes the navigation to the new speaker instead of racing a roster refresh", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ data: { contact: { contactId, name: "Ada Lovelace" } } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    await openCreateDialog();

    const email = document.querySelector<HTMLInputElement>('dialog input[type="email"]');
    if (!email) throw new Error("Email field was not rendered");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(email, "ada@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      dialogButtonNamed("Add speaker")?.click();
      await Promise.resolve();
    });

    expect(toastMock).toHaveBeenCalledWith("Ada Lovelace added");
    expect(navigation.push).toHaveBeenCalledWith(`/events/${eventId}/speakers/${contactId}`);
    // The refresh of the list being left behind is what cancelled that
    // navigation: the address bar advanced and the roster never repainted.
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(document.querySelector("dialog")).toBeNull();
  });
});
