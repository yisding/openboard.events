/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fieldIdSchema, formIdSchema, sectionIdSchema } from "@/shared/contracts";
import type { BuilderEvent, BuilderForm } from "./builder-types";
import { FormBuilder } from "./form-builder";

const routerMock = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/events/e1000000-0000-4000-8000-000000000001/forms/f1000000-0000-4000-8000-000000000001",
  useRouter: () => routerMock,
  useSearchParams: () => new URLSearchParams("step=welcome"),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: vi.fn(),
  useGuardedAction: () => ({
    runGuarded: (action: () => void) => action(),
    allowNextNavigation: (action?: () => void) => action?.(),
  }),
}));
vi.mock("@/shared/ui/app/rich-text-editor-lazy", () => ({ RichTextEditor: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const event: BuilderEvent = {
  id: "e1000000-0000-4000-8000-000000000001",
  name: "Recovery Conf",
  slug: "recovery-conf",
  timezone: "America/Los_Angeles",
  submissionCapPerUser: 3,
};

function form(overrides: Partial<BuilderForm> = {}): BuilderForm {
  const sectionId = sectionIdSchema.parse("a1000000-0000-4000-8000-000000000001");
  return {
    id: formIdSchema.parse("f1000000-0000-4000-8000-000000000001"),
    eventId: event.id,
    context: "cfp",
    targetType: null,
    internalName: "Main CFP",
    externalTitle: "Public title",
    pageHeading: "Submit",
    status: "open",
    kind: "abstract",
    collectParticipants: true,
    opensAt: null,
    closesAt: null,
    submissionLimit: null,
    showWelcome: false,
    welcomeHtml: "",
    successHtml: "",
    autoRedirectToPortal: false,
    participantRoles: [{ role: "speaker", enabled: true }],
    sendConfirmation: false,
    confirmationSubject: "",
    confirmationBodyHtml: "",
    currentVersion: 1,
    updatedAt: "2026-08-13T12:00:00.000Z",
    hasNonDraftSubmissions: false,
    sections: [{
      id: sectionId,
      key: "abstract",
      title: "Proposal",
      pageHeading: "Submit",
      descriptionHtml: "",
      sortOrder: 0,
      fields: [{
        id: fieldIdSchema.parse("a2000000-0000-4000-8000-000000000001"),
        sectionId,
        key: "title",
        label: "Title",
        fieldType: "text",
        required: true,
        locked: true,
        maxChars: 255,
        helpText: "",
        options: [],
        visibility: null,
        mapsTo: "submission.title",
        reviewVisibility: "content",
        sortOrder: 0,
      }],
    }],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function buttonNamed(name: string, within: ParentNode = container): HTMLButtonElement | undefined {
  return [...within.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function editPublicTitle(value: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[value="Public title"]');
  if (!input) throw new Error("Public title input was not rendered");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return input;
}

async function settle() {
  await act(async () => {
    for (let step = 0; step < 8; step += 1) await Promise.resolve();
  });
}

async function mount(initialForm = form()) {
  await act(async () => root.render(<FormBuilder event={event} initialForm={initialForm} />));
}

async function requestClose() {
  await act(async () => buttonNamed("Close")?.click());
  const dialog = container.querySelector("dialog");
  if (!dialog) throw new Error("Close confirmation was not rendered");
  await act(async () => buttonNamed("Close form", dialog)?.click());
  await settle();
}

beforeEach(() => {
  routerMock.push.mockReset();
  routerMock.refresh.mockReset();
  toastMock.mockReset();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  if (typeof HTMLDialogElement.prototype.showModal !== "function") {
    HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  }
  if (typeof HTMLDialogElement.prototype.close !== "function") {
    HTMLDialogElement.prototype.close = function close() { this.open = false; };
  }
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("form availability outcome recovery", () => {
  it("recovers a committed close after a lost response without replacing dirty authoring content", async () => {
    const latest = form({
      status: "closed",
      externalTitle: "Server title must not replace the draft",
      currentVersion: 2,
      updatedAt: "2026-08-13T12:01:00.000Z",
    });
    fetchMock
      .mockRejectedValueOnce(new TypeError("connection dropped after commit"))
      .mockResolvedValueOnce(response({ data: latest }));
    await mount();

    let title: HTMLInputElement | undefined;
    await act(async () => { title = editPublicTitle("Unsaved local title"); });
    await requestClose();

    expect(title?.value).toBe("Unsaved local title");
    expect(container.querySelector(".status-closed")).not.toBeNull();
    expect(container.textContent).toContain("Version 2");
    expect(container.textContent).not.toContain("Server title must not replace the draft");
    expect(container.querySelector("dialog")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(toastMock).toHaveBeenCalledWith("Form closed — confirmed from the latest saved status");
  });

  it("keeps an offline close unconfirmed, preserves the dirty draft, and blocks another PATCH", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("connection dropped"))
      .mockRejectedValueOnce(new TypeError("still offline"));
    await mount();

    let title: HTMLInputElement | undefined;
    await act(async () => { title = editPublicTitle("Unsaved while offline"); });
    await requestClose();

    const recoveryMessage = "We couldn’t confirm whether this form was closed. Restore your connection, then check the current status before retrying.";
    expect(title?.value).toBe("Unsaved while offline");
    expect(container.textContent).toContain("Form status is unconfirmed");
    expect(container.textContent).toContain(recoveryMessage);
    expect(buttonNamed("Check current status")).toBeDefined();
    expect(container.querySelector("dialog")).toBeNull();
    const close = buttonNamed("Close");
    expect(close?.disabled).toBe(true);
    await act(async () => close?.click());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(toastMock).toHaveBeenCalledWith(recoveryMessage, { kind: "error" });
  });

  it("shows definitive validation guidance without entering recovery or issuing a GET", async () => {
    fetchMock.mockResolvedValueOnce(response({
      error: { code: "VALIDATION", message: "This form must keep its required title" },
    }, 400));
    await mount();

    await requestClose();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Form status is unconfirmed");
    expect(toastMock).toHaveBeenCalledWith("This form must keep its required title", { kind: "error" });
  });

  it("treats an INTERNAL response as ambiguous and reconciles it from the server", async () => {
    fetchMock
      .mockResolvedValueOnce(response({
        error: { code: "INTERNAL", message: "The response could not be completed" },
      }, 500))
      .mockResolvedValueOnce(response({ data: form({
        status: "closed",
        currentVersion: 2,
        updatedAt: "2026-08-13T12:01:00.000Z",
      }) }));
    await mount();

    await requestClose();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector(".status-closed")).not.toBeNull();
    expect(toastMock).toHaveBeenCalledWith("Form closed — confirmed from the latest saved status");
  });
});
