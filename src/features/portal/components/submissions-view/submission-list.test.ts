import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortalSubmissionDetail, PortalSubmissionRow } from "@/features/portal";
import { ToastProvider } from "@/shared/ui/toast";
import { SubmissionDetail } from "./submission-detail";
import { SubmissionList } from "./submission-list";

Object.assign(globalThis, { React });

// The withdraw control calls `useRouter().refresh()` after a successful POST;
// no app router is mounted under `renderToStaticMarkup`.
vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  useRouter: () => ({ refresh: () => undefined }),
}));

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

const eventId = "b0000000-0000-4000-8000-000000000001";

function detail({ role, status = "Accepted", isSubmitter = false }: {
  role: PortalSubmissionRow["role"];
  status?: PortalSubmissionRow["status"];
  isSubmitter?: boolean;
}): PortalSubmissionDetail {
  return {
    ...row(role),
    status,
    descriptionHtml: null,
    isSubmitter,
    participants: [
      { contactId: "primary", name: "Ada", email: "ada@example.com", isPrimary: true, role: "speaker" },
      { contactId: "panelist", name: "Grace", email: "grace@example.com", isPrimary: false, role: "panelist" },
    ],
  };
}

function renderDetail(submission: PortalSubmissionDetail): string {
  return renderToStaticMarkup(React.createElement(
    ToastProvider,
    null,
    React.createElement(SubmissionDetail, { submission, eventId, eventSlug: "summit", timezone: "UTC" }),
  ));
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
    const html = renderToStaticMarkup(React.createElement(SubmissionDetail, {
      submission: detail({ role: "moderator" }),
      eventId,
      eventSlug: "summit",
      timezone: "UTC",
    }));

    // Standalone chips sit next to "Primary speaker", so they read sentence-case
    // rather than the mid-sentence lowercase the list view needs.
    expect(html).toContain("Primary speaker");
    expect(html).toContain("Panelist");
  });
});

describe("SubmissionDetail withdrawal", () => {
  it("offers the withdraw control to the submitter of a live proposal", () => {
    const html = renderDetail(detail({ role: "speaker", status: "Pending", isSubmitter: true }));

    expect(html).toContain("Withdraw submission");
  });

  it("hides it from a participant who is not the submitter — `withdraw` would only answer NOT_FOUND", () => {
    const html = renderDetail(detail({ role: "co_speaker", status: "Pending", isSubmitter: false }));

    expect(html).not.toContain("Withdraw submission");
  });

  it("hides it once the proposal is past withdrawing", () => {
    for (const status of ["Declined", "Withdrawn"] as const) {
      expect(renderDetail(detail({ role: "speaker", status, isSubmitter: true }))).not.toContain("Withdraw submission");
    }
  });
});
