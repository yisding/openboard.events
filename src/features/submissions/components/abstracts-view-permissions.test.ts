import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contactIdSchema, eventIdSchema, submissionIdSchema, trackIdSchema } from "@/shared/contracts";
import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";
import { AbstractsView } from "./abstracts-view";

const navigationMock = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigationMock.search),
}));

vi.mock("@/shared/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

Object.assign(globalThis, { React });

const id = (suffix: string) => `e5000000-0000-4000-8000-0000000000${suffix}`;

const ROW: SubmissionListRow = {
  submissionId: submissionIdSchema.parse(id("01")),
  code: 101,
  status: "accept_queue",
  source: "cfp",
  formId: null,
  formName: null,
  title: "Agents in production",
  descriptionPlain: "A talk about running agents in production.",
  submitterEmail: "speaker@example.com",
  submitterName: "Speaker One",
  speakers: [{ contactId: contactIdSchema.parse(id("02")), name: "Speaker One", isPrimary: true }],
  trackId: trackIdSchema.parse(id("03")),
  trackName: "Agent sessions",
  trackColor: "#00a878",
  tags: [],
  rating: 4.5,
  nScores: 3,
  notifiedAt: null,
  submittedAt: "2026-08-01T12:00:00.000Z",
  createdAt: "2026-08-01T12:00:00.000Z",
  formatName: "Talk",
  language: "en",
  level: null,
  capacity: null,
  clientSessionId: null,
  rowVersion: 1,
};

const COUNTS: Record<SubmissionStatus | "all", number> = {
  all: 1,
  accepted: 0,
  accept_queue: 1,
  pending: 0,
  decline_queue: 0,
  declined: 0,
  withdrawn: 0,
  draft: 0,
};

function renderView(canEdit: boolean, filter: { view?: "all" | "needs_decision" | "ready_to_notify" | "decided"; status?: SubmissionStatus | "all" } = {}): string {
  return renderToStaticMarkup(React.createElement(AbstractsView, {
    eventId: eventIdSchema.parse(id("04")),
    rows: [ROW],
    counts: COUNTS,
    view: filter.view ?? "all",
    status: filter.status ?? "all",
    search: "",
    timezone: "America/Los_Angeles",
    total: 1,
    filteredTotal: 1,
    page: 1,
    pageSize: 25,
    sort: "newest",
    queued: 1,
    vocabulary: { tracks: [], formats: [], tags: [] },
    speakers: [],
    canEdit,
  }));
}

describe("AbstractsView permissions", () => {
  beforeEach(() => { navigationMock.search = ""; });

  it("keeps organizer decision controls and row selection available", () => {
    const html = renderView(true);

    expect(html).toContain("Send 1 decision email");
    expect(html).toContain("Export CSV");
    expect(html).toContain("Add abstract");
    expect(html).toContain('aria-label="Select every row on this page"');
    expect(html).toContain('aria-label="Select SESS-101, Agents in production"');
  });

  it("renders reviewers a read-only table without organizer decision controls or selection", () => {
    const html = renderView(false);

    expect(html).not.toContain("Send 1 decision email");
    expect(html).not.toContain("Add abstract");
    expect(html).not.toContain('aria-label="Select every row on this page"');
    expect(html).not.toContain('aria-label="Select SESS-101, Agents in production"');
    expect(html).not.toContain('type="checkbox"');
  });

  it("exports the normalized filters that produced the visible table", () => {
    navigationMock.search = "view=needs_decision&status=declined";
    const html = renderView(true, { view: "decided", status: "declined" });

    expect(html).toContain("export.csv?view=decided&amp;status=declined");
    expect(html).not.toContain("export.csv?view=needs_decision");
  });
});
