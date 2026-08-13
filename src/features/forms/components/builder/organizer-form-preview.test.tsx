import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fieldIdSchema, formIdSchema, sectionIdSchema } from "@/shared/contracts";
import { ToastProvider } from "@/shared/ui/toast";
import type { BuilderEvent, BuilderForm } from "../../builder-types";
import { OrganizerFormPreview } from "./organizer-form-preview";

Object.assign(globalThis, { React });

const event: BuilderEvent = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Preview Conference",
  slug: "preview-conference",
  timezone: "America/Los_Angeles",
  submissionCapPerUser: 3,
};

const NOW = "2026-08-13T12:00:00.000Z";

function form(collectParticipants = true, overrides: Partial<BuilderForm> = {}): BuilderForm {
  const abstractSectionId = sectionIdSchema.parse("20000000-0000-4000-8000-000000000001");
  const participantSectionId = sectionIdSchema.parse("20000000-0000-4000-8000-000000000002");
  return {
    id: formIdSchema.parse("30000000-0000-4000-8000-000000000001"),
    eventId: event.id,
    context: "cfp",
    targetType: null,
    internalName: "Speaker applications",
    externalTitle: "Call for speakers",
    pageHeading: "Share your idea",
    status: "open",
    kind: "abstract",
    collectParticipants,
    opensAt: null,
    closesAt: null,
    submissionLimit: null,
    showWelcome: true,
    welcomeHtml: "<p>We would love to hear from you.</p>",
    successHtml: "<p>Thanks for your proposal.</p>",
    autoRedirectToPortal: false,
    participantRoles: [{ role: "speaker", enabled: true }],
    sendConfirmation: true,
    confirmationSubject: "Proposal received",
    confirmationBodyHtml: "<p>Thanks.</p>",
    currentVersion: 2,
    updatedAt: "2026-08-12T00:00:00.000Z",
    hasNonDraftSubmissions: false,
    sections: [
      {
        id: abstractSectionId,
        key: "abstract",
        title: "Proposal",
        pageHeading: "Your session",
        descriptionHtml: "<p>Tell us what attendees will learn.</p>",
        sortOrder: 0,
        fields: [{
          id: fieldIdSchema.parse("40000000-0000-4000-8000-000000000001"),
          sectionId: abstractSectionId,
          key: "title",
          label: "Title",
          fieldType: "text",
          required: true,
          locked: true,
          maxChars: 255,
          helpText: "Keep it concise.",
          options: [],
          visibility: null,
          mapsTo: "submission.title",
          reviewVisibility: "content",
          sortOrder: 0,
        }],
      },
      {
        id: participantSectionId,
        key: "participant",
        title: "Speaker",
        pageHeading: "About you",
        descriptionHtml: "",
        sortOrder: 1,
        fields: [
          {
            id: fieldIdSchema.parse("40000000-0000-4000-8000-000000000002"),
            sectionId: participantSectionId,
            key: "first_name",
            label: "First name",
            fieldType: "text",
            required: true,
            locked: true,
            maxChars: 160,
            helpText: "",
            options: [],
            visibility: null,
            mapsTo: "contact.first_name",
            reviewVisibility: "identity",
            sortOrder: 0,
          },
          {
            id: fieldIdSchema.parse("40000000-0000-4000-8000-000000000003"),
            sectionId: participantSectionId,
            key: "last_name",
            label: "Last name",
            fieldType: "text",
            required: true,
            locked: true,
            maxChars: 160,
            helpText: "",
            options: [],
            visibility: null,
            mapsTo: "contact.last_name",
            reviewVisibility: "identity",
            sortOrder: 1,
          },
          {
            id: fieldIdSchema.parse("40000000-0000-4000-8000-000000000004"),
            sectionId: participantSectionId,
            key: "email",
            label: "Speaker email",
            fieldType: "email",
            required: true,
            locked: true,
            maxChars: 320,
            helpText: "",
            options: [],
            visibility: null,
            mapsTo: "contact.email",
            reviewVisibility: "identity",
            sortOrder: 2,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function renderPreview(value: BuilderForm) {
  return renderToStaticMarkup(
    <ToastProvider><OrganizerFormPreview event={event} form={value} nowIso={NOW} /></ToastProvider>,
  );
}

describe("organizer form preview", () => {
  it("renders the saved form through an interactive, non-persisting organizer surface", () => {
    const html = renderPreview(form());

    expect(html).toContain("ORGANIZER PREVIEW");
    expect(html).toContain("Answers stay in this tab and are never saved");
    expect(html).toContain("Share your idea");
    expect(html).toContain("Your session");
    expect(html).toContain("About you");
    expect(html).toContain('required=""');
    expect(html).toContain('href="/events/10000000-0000-4000-8000-000000000001/forms/30000000-0000-4000-8000-000000000001"');
    expect(html).toContain('href="/submit/preview-conference/30000000-0000-4000-8000-000000000001"');
    expect(html).toContain("Open live form");
    expect(html).not.toContain("Send me a code");
  });

  it("does not preview participant questions when collection is disabled", () => {
    const html = renderPreview(form(false));

    expect(html).toContain("Your session");
    expect(html).not.toContain("About you");
    expect(html).not.toContain("Speaker email");
  });

  it("keeps the preview route organizer-only and scoped to CFP forms", () => {
    const page = readFileSync(new URL("../../../../app/events/[eventId]/forms/[formId]/preview/page.tsx", import.meta.url), "utf8");

    expect(page).toContain('requireAdmin(parsedEventId, "organizer")');
    expect(page).toContain('getFormForBuilder(parsedEventId, parsedFormId, "cfp")');
    expect(page).toContain("nowIso={new Date().toISOString()}");
  });

  it.each([
    { state: "draft", changes: { status: "draft" as const }, guidance: "Draft — this form is not public yet." },
    { state: "scheduled", changes: { opensAt: "2026-08-14T12:00:00.000Z" }, guidance: "Scheduled — the public form is not open yet." },
    { state: "ended", changes: { closesAt: NOW }, guidance: "The submission window has ended." },
    { state: "closed", changes: { status: "closed" as const }, guidance: "This form was closed manually." },
  ])("does not call a $state saved form live", ({ changes, guidance }) => {
    const html = renderPreview(form(true, changes));

    expect(html).toContain(guidance);
    expect(html).not.toContain("Open live form");
    expect(html).not.toContain("/submit/preview-conference/");
  });

  it("offers open and copy actions only while the saved form is live", () => {
    const html = renderPreview(form());

    expect(html).toContain("Open live form");
    expect(html).toContain("Copy link");
  });
});
