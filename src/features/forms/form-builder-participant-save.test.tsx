/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fieldIdSchema, formIdSchema, sectionIdSchema } from "@/shared/contracts";
import type { BuilderEvent, BuilderField, BuilderForm } from "./builder-types";
import { FormBuilder, PARTICIPANT_STEP_RECOVERY_MESSAGE } from "./form-builder";

const navigationMock = vi.hoisted(() => ({ search: "step=participant", push: vi.fn(), refresh: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/events/e2000000-0000-4000-8000-000000000001/forms/f2000000-0000-4000-8000-000000000001",
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
  id: "e2000000-0000-4000-8000-000000000001",
  name: "Participant Save Conf",
  slug: "participant-save-conf",
  timezone: "America/Los_Angeles",
  submissionCapPerUser: 3,
};
const participantSectionId = sectionIdSchema.parse("a2000000-0000-4000-8000-000000000001");
const participantQuestion: BuilderField = {
  id: fieldIdSchema.parse("a2000000-0000-4000-8000-000000000002"),
  sectionId: participantSectionId,
  key: "bio",
  label: "Speaker bio",
  fieldType: "textarea",
  required: false,
  locked: false,
  maxChars: 500,
  helpText: "",
  options: [],
  visibility: null,
  mapsTo: null,
  reviewVisibility: "content",
  sortOrder: 0,
};

function form(overrides: Partial<BuilderForm> = {}): BuilderForm {
  return {
    id: formIdSchema.parse("f2000000-0000-4000-8000-000000000001"),
    eventId: event.id,
    context: "cfp",
    targetType: null,
    internalName: "Main CFP",
    externalTitle: "Public title",
    pageHeading: "Submit",
    status: "draft",
    kind: "abstract",
    collectParticipants: true,
    opensAt: null,
    closesAt: null,
    submissionLimit: null,
    showWelcome: false,
    welcomeHtml: "",
    successHtml: "",
    autoRedirectToPortal: false,
    participantRoles: [
      { role: "speaker", enabled: true },
      { role: "co_speaker", enabled: false },
      { role: "moderator", enabled: false },
      { role: "panelist", enabled: false },
    ],
    sendConfirmation: false,
    confirmationSubject: "",
    confirmationBodyHtml: "",
    currentVersion: 1,
    updatedAt: "2026-08-13T12:00:00.000Z",
    hasNonDraftSubmissions: false,
    sections: [{
      id: participantSectionId,
      key: "participant",
      title: "Participant details",
      pageHeading: "Participants",
      descriptionHtml: "<p>Tell us about each speaker.</p>",
      sortOrder: 1,
      fields: [],
    }],
    ...overrides,
  };
}

function participantSection(source = form()) {
  const section = source.sections.find((candidate) => candidate.key === "participant");
  if (!section) throw new Error("Participant section was not rendered");
  return section;
}

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function inputWithValue(value: string): HTMLInputElement {
  const input = [...container.querySelectorAll<HTMLInputElement>("input")].find((candidate) => candidate.value === value);
  if (!input) throw new Error(`Input with value ${value} was not rendered`);
  return input;
}

function edit(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function requestBodies(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>);
}

async function settle() {
  await act(async () => {
    for (let step = 0; step < 10; step += 1) await Promise.resolve();
  });
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  navigationMock.search = "step=participant";
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
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("participant-step save recovery", () => {
  it("replays one exact lost-response operation and preserves heading edits made in flight", async () => {
    let rejectFirst: ((reason: unknown) => void) | undefined;
    const first = new Promise<Response>((_resolve, reject) => { rejectFirst = reject; });
    const saved = form({
      participantRoles: [
        { role: "speaker", enabled: true },
        { role: "co_speaker", enabled: true },
        { role: "moderator", enabled: false },
        { role: "panelist", enabled: false },
      ],
      currentVersion: 2,
      updatedAt: "2026-08-13T12:01:00.000Z",
      sections: [{
        ...participantSection(),
        title: "Frozen speaker details",
      }],
    });
    fetchMock
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce(response({ data: saved }));
    await act(async () => root.render(<FormBuilder event={event} initialForm={form()} />));

    await act(async () => {
      edit(inputWithValue("Participant details"), "Frozen speaker details");
      container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Allow co-speaker role"]')?.click();
    });
    await act(async () => { buttonNamed("Publish version")?.click(); await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => edit(inputWithValue("Participants"), "New local heading"));
    await act(async () => { rejectFirst?.(new TypeError("response lost after commit")); });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [original, replay] = requestBodies();
    expect(original).toEqual({
      operationId: expect.any(String),
      expectedUpdatedAt: "2026-08-13T12:00:00.000Z",
      sectionId: participantSectionId,
      participantRoles: [
        { role: "speaker", enabled: true },
        { role: "co_speaker", enabled: true },
        { role: "moderator", enabled: false },
        { role: "panelist", enabled: false },
      ],
      section: {
        title: "Frozen speaker details",
        pageHeading: "Participants",
        descriptionHtml: "<p>Tell us about each speaker.</p>",
      },
    });
    expect(replay).toEqual({ ...original, participantReplay: true });
    expect(inputWithValue("Frozen speaker details")).toBeDefined();
    expect(inputWithValue("New local heading")).toBeDefined();
    expect(container.textContent).toContain("Version 2");
    expect(toastMock).toHaveBeenCalledWith("Participant step saved — confirmed from the completed request");
  });

  it("canonicalizes a legacy speaker-only form before sending one Participant operation", async () => {
    const initial = form({ participantRoles: [{ role: "speaker", enabled: true }] });
    const saved = form({
      participantRoles: [
        { role: "speaker", enabled: true },
        { role: "co_speaker", enabled: false },
        { role: "moderator", enabled: false },
        { role: "panelist", enabled: false },
      ],
      currentVersion: 2,
      updatedAt: "2026-08-13T12:01:00.000Z",
    });
    fetchMock.mockResolvedValueOnce(response({ data: saved }));
    await act(async () => root.render(<FormBuilder event={event} initialForm={initial} />));

    await act(async () => buttonNamed("Publish version")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestBodies()[0]?.participantRoles).toEqual(saved.participantRoles);
    expect(container.textContent).toContain("Version 2");
  });

  it("publishes the whole Participant step while a question remains selected", async () => {
    const initial = form({
      sections: [{ ...participantSection(), fields: [participantQuestion] }],
    });
    const saved = form({
      currentVersion: 2,
      updatedAt: "2026-08-13T12:01:00.000Z",
      sections: [{ ...participantSection(initial), pageHeading: "People" }],
    });
    fetchMock.mockResolvedValueOnce(response({ data: saved }));
    await act(async () => root.render(<FormBuilder event={event} initialForm={initial} />));

    await act(async () => container.querySelector<HTMLButtonElement>(".field-row-main")?.click());
    expect(container.textContent).toContain("Speaker bio");
    await act(async () => edit(inputWithValue("Participants"), "People"));
    await act(async () => buttonNamed("Publish version")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/participant-step?eventId=${event.id}`);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain(`/fields/${participantQuestion.id}`);
    expect(requestBodies()[0]?.section).toEqual({
      title: "Participant details",
      pageHeading: "People",
      descriptionHtml: "<p>Tell us about each speaker.</p>",
    });
    expect(container.textContent).toContain("Version 2");
  });

  it("keeps repeated ambiguity locked and replays the same frozen operation from the recovery control", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("connection dropped"))
      .mockRejectedValueOnce(new TypeError("still offline"))
      .mockRejectedValueOnce(new TypeError("still offline"));
    await act(async () => root.render(<FormBuilder event={event} initialForm={form({ hasNonDraftSubmissions: true })} />));

    await act(async () => edit(inputWithValue("Participants"), "Offline heading"));
    await act(async () => buttonNamed("Publish version")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Participant save is unconfirmed");
    expect(container.textContent).toContain(PARTICIPANT_STEP_RECOVERY_MESSAGE);
    expect(buttonNamed("Publish version")?.disabled).toBe(true);
    expect(buttonNamed("Duplicate as draft")?.disabled).toBe(true);
    expect(inputWithValue("Offline heading")).toBeDefined();

    await act(async () => buttonNamed("Confirm participant save")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const bodies = requestBodies();
    expect(bodies[1]).toEqual({ ...bodies[0], participantReplay: true });
    expect(bodies[2]).toEqual(bodies[1]);
    expect(container.textContent).toContain("Participant save is unconfirmed");
    expect(buttonNamed("Publish version")?.disabled).toBe(true);
    expect(toastMock).toHaveBeenCalledWith(PARTICIPANT_STEP_RECOVERY_MESSAGE, { kind: "error" });
  });

  it("keeps the participant draft editable after a definitive validation failure", async () => {
    fetchMock.mockResolvedValueOnce(response({
      error: { code: "VALIDATION", message: "Participant heading is required" },
    }, 400));
    await act(async () => root.render(<FormBuilder event={event} initialForm={form()} />));

    await act(async () => edit(inputWithValue("Participants"), "Draft heading"));
    await act(async () => buttonNamed("Publish version")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Participant save is unconfirmed");
    expect(buttonNamed("Publish version")?.disabled).toBe(false);
    expect(inputWithValue("Draft heading")).toBeDefined();
    expect(toastMock).toHaveBeenCalledWith("Participant heading is required", { kind: "error" });
  });

  it("treats a malformed success as ambiguous and confirms it by exact replay", async () => {
    const saved = form({
      currentVersion: 2,
      updatedAt: "2026-08-13T12:01:00.000Z",
    });
    fetchMock
      .mockResolvedValueOnce(response({ data: { id: saved.id } }))
      .mockResolvedValueOnce(response({ data: saved }));
    await act(async () => root.render(<FormBuilder event={event} initialForm={form()} />));

    await act(async () => buttonNamed("Publish version")?.click());
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [original, replay] = requestBodies();
    expect(replay).toEqual({ ...original, participantReplay: true });
    expect(container.textContent).toContain("Version 2");
    expect(container.textContent).not.toContain("Participant save is unconfirmed");
  });
});
