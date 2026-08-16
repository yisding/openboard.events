/** @vitest-environment happy-dom */

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fieldIdSchema, formIdSchema, sectionIdSchema } from "@/shared/contracts";
import type { BuilderEvent, BuilderField, BuilderForm } from "./builder-types";
import { FormBuilder } from "./form-builder";

/**
 * A conditional question on a form somebody has already answered.
 *
 * The rule itself is locked — visibility is structural, and `guards.ts` refuses
 * a structural patch once a non-draft submission is pinned to a version — but
 * the *fact* is not. Hiding the rule left the question list badging a field
 * "Conditional" and the inspector giving the organizer no way to find out
 * conditional on what, on the one form where the question matters most: the
 * live call for speakers, which is the only form that can be in this state.
 */

const navigationMock = vi.hoisted(() => ({ search: "step=abstract", push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/events/e4000000-0000-4000-8000-000000000001/forms/f4000000-0000-4000-8000-000000000001",
  useRouter: () => navigationMock,
  useSearchParams: () => new URLSearchParams(navigationMock.search),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
vi.mock("@/shared/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
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
  id: "e4000000-0000-4000-8000-000000000001",
  name: "Locked Visibility Conf",
  slug: "locked-visibility-conf",
  timezone: "America/Los_Angeles",
  submissionCapPerUser: 3,
};
const sectionId = sectionIdSchema.parse("a4000000-0000-4000-8000-000000000001");
const formatId = fieldIdSchema.parse("a4000000-0000-4000-8000-000000000002");
const durationId = fieldIdSchema.parse("a4000000-0000-4000-8000-000000000003");
const workshopOptionId = "opt-workshop";

const format: BuilderField = {
  id: formatId,
  sectionId,
  key: "format",
  label: "Format",
  fieldType: "dropdown",
  required: true,
  locked: false,
  maxChars: null,
  helpText: "",
  options: [{ id: workshopOptionId, label: "Workshop" }, { id: "opt-talk", label: "Talk" }],
  visibility: null,
  mapsTo: null,
  reviewVisibility: "content",
  sortOrder: 0,
};

const duration: BuilderField = {
  ...format,
  id: durationId,
  key: "workshop_duration",
  label: "Workshop duration",
  fieldType: "text",
  required: false,
  options: [],
  visibility: { match: "all", conditions: [{ sourceFieldId: formatId, op: "eq", value: workshopOptionId }] },
  sortOrder: 1,
};

function form(hasNonDraftSubmissions: boolean): BuilderForm {
  return {
    id: formIdSchema.parse("f4000000-0000-4000-8000-000000000001"),
    eventId: event.id,
    context: "cfp",
    targetType: null,
    internalName: "Speak at Locked Visibility Conf",
    externalTitle: "Public title",
    pageHeading: "Submit",
    status: "open",
    kind: "abstract",
    collectParticipants: false,
    opensAt: null,
    closesAt: null,
    submissionLimit: null,
    participantRoles: [
      { role: "speaker", enabled: true },
      { role: "co_speaker", enabled: false },
      { role: "moderator", enabled: false },
      { role: "panelist", enabled: false },
    ],
    showWelcome: false,
    welcomeHtml: "",
    successHtml: "",
    autoRedirectToPortal: false,
    sendConfirmation: false,
    confirmationSubject: "",
    confirmationBodyHtml: "",
    currentVersion: 2,
    updatedAt: "2026-08-16T12:00:00.000Z",
    hasNonDraftSubmissions,
    sections: [{
      id: sectionId,
      key: "abstract",
      title: "Submission details",
      pageHeading: "Session",
      descriptionHtml: "",
      sortOrder: 0,
      fields: [format, duration],
    }],
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  navigationMock.search = "step=abstract";
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function openQuestion(label: string) {
  const row = [...document.querySelectorAll<HTMLButtonElement>("button.field-row-main")]
    .find((button) => button.textContent?.includes(label));
  if (!row) throw new Error(`No question row for ${label}`);
  await act(async () => row.click());
}

describe("a conditional question on a form that is already carrying submissions", () => {
  it("still says what the rule is, read-only", async () => {
    await act(async () => root.render(<FormBuilder event={event} initialForm={form(true)} />));
    await openQuestion("Workshop duration");

    const card = document.querySelector(".visibility-rule-editor");
    expect(card, "the tour points at this card by class, and so does the organizer's eye").not.toBeNull();
    expect(card?.textContent).toContain("Visibility is locked after the first submission.");
    expect(card?.textContent).toContain("Shown when Format is Workshop.");
    // Locked means locked: no segmented control, no condition rows, nothing
    // that looks like it would save.
    expect(card?.querySelector("select")).toBeNull();
    expect(card?.querySelector("button")).toBeNull();
  });

  it("says nothing extra about a question that has no rule", async () => {
    await act(async () => root.render(<FormBuilder event={event} initialForm={form(true)} />));
    await openQuestion("Format");

    const card = document.querySelector(".visibility-rule-editor");
    expect(card?.textContent).toContain("Visibility is locked after the first submission.");
    expect(card?.textContent).not.toContain("Shown when");
  });

  it("hands back the editor as soon as the form is free to change", async () => {
    await act(async () => root.render(<FormBuilder event={event} initialForm={form(false)} />));
    await openQuestion("Workshop duration");

    const card = document.querySelector(".visibility-rule-editor");
    expect(card?.textContent).toContain("Shown when Format is Workshop.");
    expect(card?.textContent).not.toContain("Visibility is locked after the first submission.");
    expect(card?.querySelector("select")).not.toBeNull();
  });
});
