/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eventDtoSchema, organizationIdSchema } from "@/shared/contracts";
import { OnboardingWizard, type OnboardingResumeState } from "./onboarding-wizard";

const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@/shared/ui/toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const organizationId = organizationIdSchema.parse("00000000-0000-4000-8000-000000000001");
const event = eventDtoSchema.parse({
  id: "10000000-0000-4000-8000-000000000001",
  name: "First Form Conf",
  slug: "first-form-conf",
  eventType: "conference",
  websiteUrl: null,
  location: null,
  physicalAddress: null,
  timezone: "America/Los_Angeles",
  startsAt: "2030-09-15T16:00:00.000Z",
  endsAt: "2030-09-17T01:00:00.000Z",
  theme: null,
  logoFileId: null,
  backgroundFileId: null,
  submissionCapPerUser: 3,
  rowVersion: 1,
});
const initialState: OnboardingResumeState = {
  step: "form",
  event,
  tracks: [],
  formId: null,
  form: null,
  publicFormUrl: null,
  formAvailability: null,
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function buttonNamed(name: string, within: ParentNode = container): HTMLButtonElement | undefined {
  return [...within.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim().includes(name));
}

async function renderFormStep(state: OnboardingResumeState = initialState) {
  await act(async () => root.render(<OnboardingWizard
    organizationId={organizationId}
    organizationName="First Form Org"
    hasExistingEvents={false}
    initialState={state}
    nowIso="2026-08-13T12:00:00.000Z"
  />));
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function success(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function failure(message: string, status = 503): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function unreadableSuccess(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => { throw new TypeError("connection closed before the response body completed"); },
  } as unknown as Response;
}

beforeEach(() => {
  toastMock.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
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

describe("first-form publication preflight", () => {
  it("requires an explicit confirmation before creating or publishing the default form", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await renderFormStep();

    const launch = buttonNamed("Create and publish form");
    expect(launch).toBeDefined();
    await act(async () => launch?.click());

    const dialog = container.querySelector("dialog");
    expect(dialog?.getAttribute("aria-label")).toBe("Create and publish “Call for Speakers” now?");
    expect(dialog?.textContent).toContain("starts accepting speaker submissions");
    expect(dialog?.textContent).toContain("Speakers can create and update submissions until");
    expect(dialog?.textContent).toContain("PDT");
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => buttonNamed("Cancel", dialog ?? container)?.click());
    expect(container.querySelector("dialog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => launch?.click());
    const reopened = container.querySelector("dialog");
    await act(async () => {
      buttonNamed("Create and publish form", reopened ?? container)?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector("dialog")).not.toBeNull();
  });

  it("keeps draft creation a truthful one-click action", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    await renderFormStep();

    const publish = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    await act(async () => publish?.click());
    expect(publish?.checked).toBe(false);

    const createDraft = buttonNamed("Create draft");
    expect(createDraft).toBeDefined();
    await act(async () => {
      createDraft?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("surfaces a user-actionable response without replaying it", async () => {
    fetchMock.mockResolvedValue(failure("Setup changed; reload and try again", 409));
    await renderFormStep();

    await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    await act(async () => {
      buttonNamed("Create draft")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(toastMock).toHaveBeenCalledWith("Setup changed; reload and try again", { kind: "error" });
  });

  it("reconciles a cached open form and gates stale-state republication behind confirmation", async () => {
    const cachedOpen = {
      id: "30000000-0000-4000-8000-000000000001",
      internalName: "Speaker applications",
      status: "open",
      updatedAt: "2026-08-13T12:00:00.000Z",
      closesAt: "2030-08-18T06:59:59.999Z",
    };
    const serverDraft = {
      ...cachedOpen,
      status: "draft",
      updatedAt: "2026-08-13T12:01:00.000Z",
    };
    const serverOpen = {
      ...serverDraft,
      status: "open",
      updatedAt: "2026-08-13T12:02:00.000Z",
    };
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (path.includes(`/api/internal/forms/${cachedOpen.id}`) && method === "GET") return success(serverDraft);
      if (path.includes(`/api/internal/forms/${cachedOpen.id}`) && method === "PATCH") return success(serverOpen);
      return success({});
    });
    await renderFormStep({
      ...initialState,
      formId: cachedOpen.id,
      form: cachedOpen,
    });

    expect(buttonNamed("Finish setup")).toBeDefined();
    await act(async () => buttonNamed("Finish setup")?.click());
    await settle();

    const dialog = container.querySelector("dialog");
    expect(dialog?.getAttribute("aria-label")).toBe("Publish “Speaker applications” now?");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `/api/internal/forms/${cachedOpen.id}?eventId=${event.id}`,
      undefined,
    );
    expect(fetchMock.mock.calls.some(([path, init]) =>
      String(path).includes(`/api/internal/forms/${cachedOpen.id}`) && (init as RequestInit | undefined)?.method === "PATCH"))
      .toBe(false);

    await act(async () => buttonNamed("Retry publishing", dialog ?? container)?.click());
    await settle();

    const formPatches = fetchMock.mock.calls.filter(([path, init]) =>
      String(path).includes(`/api/internal/forms/${cachedOpen.id}`) && (init as RequestInit | undefined)?.method === "PATCH");
    expect(formPatches).toHaveLength(1);
    expect(JSON.parse(String((formPatches[0]?.[1] as RequestInit | undefined)?.body))).toMatchObject({
      expectedUpdatedAt: serverDraft.updatedAt,
      patch: { status: "open", closesAt: cachedOpen.closesAt },
    });
  });

  it.each([
    { failureKind: "server failure", firstResponse: () => failure("temporarily unavailable") },
    { failureKind: "truncated successful response", firstResponse: unreadableSuccess },
  ])("retries a $failureKind before showing the ready handoff", async ({ firstResponse }) => {
    const cachedOpen = {
      id: "30000000-0000-4000-8000-000000000002",
      internalName: "Speaker applications",
      status: "open",
      updatedAt: "2026-08-13T12:00:00.000Z",
      closesAt: "2030-08-18T06:59:59.999Z",
    };
    let completionAttempts = 0;
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (path.includes(`/api/internal/forms/${cachedOpen.id}`) && method === "GET") return success(cachedOpen);
      if (path.includes("/onboarding/event") && method === "PATCH") {
        const body = JSON.parse(String(init?.body)) as { step: string };
        if (body.step === "complete") {
          completionAttempts += 1;
          if (completionAttempts === 1) return firstResponse();
        }
        return success(body);
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    await renderFormStep({
      ...initialState,
      formId: cachedOpen.id,
      form: cachedOpen,
    });

    await act(async () => {
      buttonNamed("Finish setup")?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(completionAttempts).toBe(2);
    expect(container.textContent).toContain("First Form Conf is ready");
    expect(toastMock).toHaveBeenCalledWith("Your call for speakers is live");
  });
});
