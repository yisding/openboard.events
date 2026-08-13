import { describe, expect, it } from "vitest";
import type { BuilderForm } from "@/features/forms";
import { mergePortalTopLevelDraft } from "./portal-form-builder";

describe("mergePortalTopLevelDraft", () => {
  it("accepts fresh server structure and concurrency data while preserving notification edits", () => {
    const local = {
      id: "form",
      updatedAt: "old",
      currentVersion: 1,
      sections: [{ id: "old-section" }],
      sendConfirmation: true,
      confirmationSubject: "Local subject",
      confirmationBodyHtml: "<p>Local body</p>",
    } as unknown as BuilderForm;
    const server = {
      id: "form",
      updatedAt: "fresh",
      currentVersion: 2,
      sections: [{ id: "fresh-section" }],
      sendConfirmation: false,
      confirmationSubject: "Server subject",
      confirmationBodyHtml: "<p>Server body</p>",
    } as unknown as BuilderForm;

    expect(mergePortalTopLevelDraft(server, local)).toMatchObject({
      updatedAt: "fresh",
      currentVersion: 2,
      sections: [{ id: "fresh-section" }],
      sendConfirmation: true,
      confirmationSubject: "Local subject",
      confirmationBodyHtml: "<p>Local body</p>",
    });
  });
});
