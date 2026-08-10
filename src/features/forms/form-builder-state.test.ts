import { describe, expect, it } from "vitest";
import type { BuilderForm } from "./builder-types";
import { mergeUnsavedBuilderEdits, type BuilderDirtyTarget } from "./form-builder-state";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing test fixture value");
  return value;
}

function form(): BuilderForm {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    eventId: "10000000-0000-4000-8000-000000000002",
    context: "cfp",
    internalName: "Form",
    externalTitle: "Form",
    pageHeading: "Welcome",
    status: "draft",
    kind: "abstract",
    collectParticipants: true,
    opensAt: null,
    closesAt: null,
    submissionLimit: null,
    showWelcome: true,
    welcomeHtml: "",
    successHtml: "",
    autoRedirectToPortal: false,
    participantRoles: [{ role: "speaker", enabled: true }],
    sendConfirmation: true,
    confirmationSubject: "Received",
    confirmationBodyHtml: "",
    currentVersion: 1,
    updatedAt: "2026-08-09T00:00:00.000Z",
    hasNonDraftSubmissions: false,
    sections: [{
      id: "10000000-0000-4000-8000-000000000003",
      key: "abstract",
      title: "Abstract",
      pageHeading: "Submission",
      descriptionHtml: "",
      sortOrder: 0,
      fields: [{
        id: "10000000-0000-4000-8000-000000000004",
        sectionId: "10000000-0000-4000-8000-000000000003",
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
        sortOrder: 0,
      }],
    }],
  } as unknown as BuilderForm;
}

describe("mergeUnsavedBuilderEdits", () => {
  it("keeps an unrelated dirty section after a field save", () => {
    const local = form();
    const localSection = required(local.sections[0]);
    localSection.title = "Unsaved section title";
    required(localSection.fields[0]).label = "Locally edited field";
    const server = form();
    required(required(server.sections[0]).fields[0]).label = "Saved field";
    server.currentVersion = 2;
    server.updatedAt = "2026-08-09T01:00:00.000Z";

    const merged = mergeUnsavedBuilderEdits(server, local, new Set<BuilderDirtyTarget>([`section:${localSection.id}`]));
    const mergedSection = required(merged.sections[0]);
    expect(mergedSection.title).toBe("Unsaved section title");
    expect(required(mergedSection.fields[0]).label).toBe("Saved field");
    expect(merged.currentVersion).toBe(2);
    expect(merged.updatedAt).toBe(server.updatedAt);
  });

  it("keeps dirty form-step values while accepting fresh server metadata", () => {
    const local = form();
    local.externalTitle = "Unsaved public title";
    const server = form();
    server.externalTitle = "Stored title";
    server.currentVersion = 3;

    const merged = mergeUnsavedBuilderEdits(server, local, new Set(["step:welcome"]));
    expect(merged.externalTitle).toBe("Unsaved public title");
    expect(merged.currentVersion).toBe(3);
  });
});
