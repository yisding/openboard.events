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

async function renderFormStep() {
  await act(async () => root.render(<OnboardingWizard
    organizationId={organizationId}
    organizationName="First Form Org"
    hasExistingEvents={false}
    initialState={initialState}
    nowIso="2026-08-13T12:00:00.000Z"
  />));
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
    expect(fetchMock).toHaveBeenCalledOnce();
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

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.querySelector("dialog")).toBeNull();
  });
});
