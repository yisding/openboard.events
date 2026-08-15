/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fieldIdSchema, formIdSchema, sectionIdSchema } from "@/shared/contracts";
import type { BuilderEvent, BuilderForm } from "./builder-types";
import { FormBuilder, mergeFormAvailabilityAuthority } from "./form-builder";
import { settle } from "@tests/support/react";

const navigationMock = vi.hoisted(() => ({ search: "step=welcome", push: vi.fn(), refresh: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/events/e1000000-0000-4000-8000-000000000001/forms/f1000000-0000-4000-8000-000000000001",
  useRouter: () => navigationMock,
  useSearchParams: () => new URLSearchParams(navigationMock.search),
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


async function mount(initialForm = form()) {
  await act(async () => root.render(<FormBuilder event={event} initialForm={initialForm} />));
}

async function requestClose() {
  await act(async () => buttonNamed("Stop accepting submissions")?.click());
  const dialog = container.querySelector("dialog");
  if (!dialog) throw new Error("Close confirmation was not rendered");
  await act(async () => buttonNamed("Stop accepting submissions", dialog)?.click());
  await settle();
}

beforeEach(() => {
  navigationMock.search = "step=welcome";
  navigationMock.push.mockReset();
  navigationMock.refresh.mockReset();
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
  vi.useRealTimers();
  container.remove();
  vi.unstubAllGlobals();
});

describe("form availability outcome recovery", () => {
  it("updates a scheduled lifecycle action when the opening boundary passes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    await mount(form({ opensAt: "2026-08-13T12:00:00.100Z" }));

    expect(buttonNamed("Cancel scheduled opening")).toBeDefined();
    await act(async () => vi.advanceTimersByTimeAsync(200));

    expect(buttonNamed("Stop accepting submissions")).toBeDefined();
    expect(buttonNamed("Cancel scheduled opening")).toBeUndefined();
  });

  it("refreshes effective availability again when the lifecycle action is requested", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    await mount(form({ opensAt: "2026-08-13T12:01:00.000Z" }));
    expect(buttonNamed("Cancel scheduled opening")).toBeDefined();

    // Simulate a backgrounded tab whose boundary timer was throttled.
    vi.setSystemTime(new Date("2026-08-13T12:02:00.000Z"));
    await act(async () => buttonNamed("Cancel scheduled opening")?.click());

    const dialog = container.querySelector("dialog");
    expect(dialog?.textContent).toContain("Stop accepting submissions now?");
    expect(buttonNamed("Stop accepting submissions", dialog ?? container)).toBeDefined();
  });

  it("adopts the full concurrent server form while preserving only dirty authoring targets after recovery", async () => {
    const opensAt = "2026-09-01T16:00:00.000Z";
    const closesAt = "2026-09-15T23:00:00.000Z";
    const latest = form({
      status: "closed",
      externalTitle: "Server title must not replace the draft",
      opensAt,
      closesAt,
      submissionLimit: 7,
      currentVersion: 2,
      updatedAt: "2026-08-13T12:01:00.000Z",
    });
    const saved = form({
      ...latest,
      currentVersion: 3,
      updatedAt: "2026-08-13T12:02:00.000Z",
    });
    fetchMock
      .mockRejectedValueOnce(new TypeError("connection dropped after commit"))
      .mockResolvedValueOnce(response({ data: latest }))
      .mockResolvedValueOnce(response({ data: saved }));
    await mount();

    let title: HTMLInputElement | undefined;
    await act(async () => { title = editPublicTitle("Unsaved local title"); });
    await requestClose();

    expect(title?.value).toBe("Unsaved local title");
    expect(container.querySelector('[data-status="closed"]')).not.toBeNull();
    expect(container.textContent).toContain("Version 2");
    expect(container.textContent).not.toContain("Server title must not replace the draft");
    expect(container.querySelector("dialog")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "PATCH")).toBe(true);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const replayBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as Record<string, unknown>;
    expect(firstBody).toEqual({
      expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
      patch: { status: "closed" },
    });
    expect(replayBody).toEqual({ ...firstBody, availabilityReplay: true });
    expect(toastMock).toHaveBeenCalledWith("Form closed — confirmed from the completed request");

    navigationMock.search = "step=settings";
    await act(async () => root.render(<FormBuilder event={event} initialForm={form()} />));
    const deadlineInputs = [...container.querySelectorAll<HTMLInputElement>(".datetime-picker-input")];
    const display = (value: string) => new Intl.DateTimeFormat("en-US", {
      timeZone: event.timezone,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
    expect(deadlineInputs.map((input) => input.value)).toEqual([display(opensAt), display(closesAt)]);
    expect(container.querySelector<HTMLInputElement>('input[type="number"]')?.value).toBe("7");

    await act(async () => buttonNamed("Publish version")?.click());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const settingsBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body)) as Record<string, unknown>;
    expect(settingsBody).toMatchObject({
      expectedUpdatedAt: latest.updatedAt,
      patch: { status: "closed", opensAt, closesAt, submissionLimit: 7 },
    });
    navigationMock.search = "step=welcome";
    await act(async () => root.render(<FormBuilder event={event} initialForm={form()} />));
    expect(container.querySelector<HTMLInputElement>('input[value="Unsaved local title"]')?.value).toBe("Unsaved local title");
    expect(container.textContent).toContain("Version 3");
  });

  it("keeps a dirty Settings draft without letting its prior status undo the confirmed lifecycle result", () => {
    const local = form({
      status: "open",
      opensAt: "2026-10-01T16:00:00.000Z",
      closesAt: "2026-10-15T23:00:00.000Z",
    });
    const authoritative = form({
      status: "closed",
      opensAt: "2026-09-01T16:00:00.000Z",
      closesAt: "2026-09-15T23:00:00.000Z",
      currentVersion: 4,
      updatedAt: "2026-08-13T12:04:00.000Z",
    });

    expect(mergeFormAvailabilityAuthority(local, authoritative, new Set(["step:settings"]))).toMatchObject({
      status: "closed",
      opensAt: local.opensAt,
      closesAt: local.closesAt,
      currentVersion: authoritative.currentVersion,
      updatedAt: authoritative.updatedAt,
    });
  });

  it("keeps repeated offline ambiguity locked and replays the same original operation from the recovery control", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("connection dropped"))
      .mockRejectedValueOnce(new TypeError("still offline"))
      .mockRejectedValueOnce(new TypeError("still offline"));
    await mount();

    let title: HTMLInputElement | undefined;
    await act(async () => { title = editPublicTitle("Unsaved while offline"); });
    await requestClose();

    const recoveryMessage = "We couldn’t confirm whether this form was closed. Restore your connection, then check the current status before retrying.";
    expect(title?.value).toBe("Unsaved while offline");
    expect(container.textContent).toContain("Form status is unconfirmed");
    expect(container.textContent).toContain(recoveryMessage);
    expect(buttonNamed("Confirm current status")).toBeDefined();
    expect(container.querySelector("dialog")).toBeNull();
    const close = buttonNamed("Stop accepting submissions");
    expect(close?.disabled).toBe(true);
    await act(async () => close?.click());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => buttonNamed("Confirm current status")?.click());
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
    expect(bodies).toEqual([
      { expectedUpdatedAt: "2026-08-13T12:00:00.000Z", patch: { status: "closed" } },
      { expectedUpdatedAt: "2026-08-13T12:00:00.000Z", patch: { status: "closed" }, availabilityReplay: true },
      { expectedUpdatedAt: "2026-08-13T12:00:00.000Z", patch: { status: "closed" }, availabilityReplay: true },
    ]);
    expect(title?.value).toBe("Unsaved while offline");
    expect(container.textContent).toContain("Form status is unconfirmed");
    expect(buttonNamed("Stop accepting submissions")?.disabled).toBe(true);
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
    expect(container.querySelector('[data-status="closed"]')).not.toBeNull();
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === "PATCH")).toBe(true);
    expect(toastMock).toHaveBeenCalledWith("Form closed — confirmed from the completed request");
  });
});
