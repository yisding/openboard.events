/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fieldIdSchema, formIdSchema, sectionIdSchema } from "@/shared/contracts";
import type { BuilderEvent, BuilderField, BuilderForm } from "./builder-types";
import { FormBuilder } from "./form-builder";

const navigationMock = vi.hoisted(() => ({ search: "step=settings", push: vi.fn(), refresh: vi.fn() }));
const toastMock = vi.hoisted(() => vi.fn());
const guardMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  usePathname: () => "/events/e3000000-0000-4000-8000-000000000001/forms/f3000000-0000-4000-8000-000000000001",
  useRouter: () => navigationMock,
  useSearchParams: () => new URLSearchParams(navigationMock.search),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/shared/ui/app/unsaved-work-guard", () => ({
  useUnsavedWorkGuard: guardMock,
  useGuardedAction: () => ({
    runGuarded: (action: () => void) => action(),
    allowNextNavigation: (action?: () => void) => action?.(),
  }),
}));
vi.mock("@/shared/ui/app/rich-text-editor-lazy", () => ({ RichTextEditor: () => null }));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const event: BuilderEvent = {
  id: "e3000000-0000-4000-8000-000000000001",
  name: "Step Publishing Conf",
  slug: "step-publishing-conf",
  timezone: "America/Los_Angeles",
  submissionCapPerUser: 3,
};
const abstractSectionId = sectionIdSchema.parse("a3000000-0000-4000-8000-000000000001");
const question: BuilderField = {
  id: fieldIdSchema.parse("a3000000-0000-4000-8000-000000000002"),
  sectionId: abstractSectionId,
  key: "speaker_notes",
  label: "Speaker notes",
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
    id: formIdSchema.parse("f3000000-0000-4000-8000-000000000001"),
    eventId: event.id,
    context: "cfp",
    targetType: null,
    internalName: "Main CFP",
    externalTitle: "Public title",
    pageHeading: "Submit",
    status: "draft",
    kind: "abstract",
    collectParticipants: false,
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
      id: abstractSectionId,
      key: "abstract",
      title: "Submission details",
      pageHeading: "Session",
      descriptionHtml: "<p>Tell us about the session.</p>",
      sortOrder: 0,
      fields: [question],
    }],
    ...overrides,
  };
}

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function buttonNamed(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === name);
}

function switchLabelled(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`);
}

async function settle() {
  await act(async () => {
    for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
  });
}

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  navigationMock.search = "step=settings";
  navigationMock.push.mockReset();
  navigationMock.refresh.mockReset();
  toastMock.mockReset();
  guardMock.mockReset();
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

describe("the wizard's step controls", () => {
  it("offers no Next at the end of the wizard, and no Back at its start", async () => {
    navigationMock.search = "step=notifications";
    await act(async () => root.render(<FormBuilder event={event} initialForm={form()} />));
    expect(buttonNamed("Next")).toBeUndefined();
    expect(buttonNamed("Back")).toBeDefined();

    navigationMock.search = "step=setup";
    await act(async () => root.render(<FormBuilder event={event} initialForm={form()} />));
    expect(buttonNamed("Back")).toBeUndefined();
    expect(buttonNamed("Next")).toBeDefined();
  });
});

describe("stepping away from an edited builder step", () => {
  it("walks straight on when the current step has nothing unpublished", async () => {
    await act(async () => root.render(<FormBuilder event={event} initialForm={form()} />));

    await act(async () => buttonNamed("Next")?.click());

    expect(navigationMock.push).toHaveBeenCalledWith(expect.stringContaining("step=notifications"), { scroll: false });
    expect(document.body.textContent).not.toContain("Publish this step before leaving it?");
  });

  it("names the unpublished step instead of dropping the edit on the way to the next one", async () => {
    await act(async () => root.render(<FormBuilder event={event} initialForm={form()} />));
    await act(async () => switchLabelled("Set submission limit")?.click());

    await act(async () => buttonNamed("Next")?.click());

    expect(navigationMock.push).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Publish this step before leaving it?");
    expect(document.body.textContent).toContain("Settings");
  });

  it("publishes the step it asked about, then continues", async () => {
    fetchMock.mockResolvedValueOnce(response({ data: form({ submissionLimit: 1, currentVersion: 2, updatedAt: "2026-08-13T12:05:00.000Z" }) }));
    await act(async () => root.render(<FormBuilder event={event} initialForm={form()} />));
    await act(async () => switchLabelled("Set submission limit")?.click());
    await act(async () => buttonNamed("Next")?.click());

    await act(async () => buttonNamed("Publish and continue")?.click());
    await settle();

    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({ patch: { submissionLimit: 1 } });
    expect(navigationMock.push).toHaveBeenCalledWith(expect.stringContaining("step=notifications"), { scroll: false });
  });

  it("leaves the step when the organizer chooses to continue without publishing", async () => {
    await act(async () => root.render(<FormBuilder event={event} initialForm={form()} />));
    await act(async () => switchLabelled("Set submission limit")?.click());
    await act(async () => buttonNamed("Next")?.click());

    await act(async () => buttonNamed("Continue without publishing")?.click());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigationMock.push).toHaveBeenCalledWith(expect.stringContaining("step=notifications"), { scroll: false });
  });

  // A save that reports success must also stop claiming the work is unsaved:
  // the guard is what raises "Discard unsaved work?" on the very next click.
  it("disarms the unsaved-work guard once a question save lands", async () => {
    navigationMock.search = "step=abstract";
    // The routing-rules panel loads itself on this step; only the field PATCH
    // is this test's subject.
    fetchMock.mockImplementation((_input, init) => Promise.resolve(init?.method === "PATCH"
      ? response({ data: form({ currentVersion: 2, updatedAt: "2026-08-13T12:05:00.000Z" }) })
      : response({ data: [] })));
    await act(async () => root.render(<FormBuilder event={event} initialForm={form()} />));

    await act(async () => document.querySelector<HTMLButtonElement>(".field-row-main")?.click());
    await act(async () => switchLabelled("Require Speaker notes")?.click());
    expect(guardMock.mock.lastCall?.[0]).toBe(true);

    await act(async () => buttonNamed("Save question")?.click());
    await settle();

    expect(toastMock).toHaveBeenCalledWith("Question saved");
    expect(guardMock.mock.lastCall?.[0]).toBe(false);
  });
});
