import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PortalSubmissionDetail, PortalSubmissionRow } from "@/features/portal";
import { SubmissionDetail } from "./submission-detail";
import { SubmissionList } from "./submission-list";

Object.assign(globalThis, { React });

function row(role: PortalSubmissionRow["role"]): PortalSubmissionRow {
  return {
    submissionId: "a0000000-0000-4000-8000-000000000001",
    code: 42,
    title: "Role-aware panels",
    status: "Accepted",
    isPrimary: false,
    role,
    formId: null,
    trackName: null,
    formatName: null,
    trackColor: null,
    submittedAt: null,
    updatedAt: "2026-08-11T00:00:00.000Z",
    formClosesAt: null,
  };
}

describe("SubmissionList participant roles", () => {
  it("names the exact non-primary role instead of calling everyone a co-speaker", () => {
    const moderator = renderToStaticMarkup(React.createElement(SubmissionList, { rows: [row("moderator")], eventSlug: "summit", timezone: "UTC" }));
    const panelist = renderToStaticMarkup(React.createElement(SubmissionList, { rows: [row("panelist")], eventSlug: "summit", timezone: "UTC" }));

    expect(moderator).toContain("You are a moderator");
    expect(panelist).toContain("You are a panelist");
    expect(moderator).not.toContain("You are a co-speaker");
  });

  it("names each participant's exact role in submission detail", () => {
    const submission: PortalSubmissionDetail = {
      ...row("moderator"),
      descriptionHtml: null,
      participants: [
        { contactId: "primary", name: "Ada", email: "ada@example.com", isPrimary: true, role: "speaker" },
        { contactId: "panelist", name: "Grace", email: "grace@example.com", isPrimary: false, role: "panelist" },
      ],
    };
    const html = renderToStaticMarkup(React.createElement(SubmissionDetail, { submission, eventSlug: "summit", timezone: "UTC" }));

    expect(html).toContain("Primary speaker");
    expect(html).toContain("panelist");
  });
});
