import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SubmissionView } from "@/features/submissions";
import { contactIdSchema, submissionIdSchema, trackIdSchema } from "@/shared/contracts";
import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";
import { AbstractsTable, abstractWorkflowTabs } from "./abstracts-table";

Object.assign(globalThis, { React });

const id = (suffix: string) => `e5000000-0000-4000-8000-0000000000${suffix}`;

const ROW: SubmissionListRow = {
  submissionId: submissionIdSchema.parse(id("01")),
  code: 101,
  status: "pending",
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
  all: 7,
  accepted: 1,
  accept_queue: 2,
  pending: 1,
  decline_queue: 1,
  declined: 1,
  withdrawn: 1,
  draft: 0,
};

function renderTable(
  rows: SubmissionListRow[],
  status: SubmissionStatus | "all" = "all",
  view: SubmissionView = "all",
  total = rows.length,
): string {
  return renderToStaticMarkup(
    React.createElement(AbstractsTable, {
      eventId: "00000000-0000-4000-8000-000000000001",
      rows,
      counts: COUNTS,
      view,
      status,
      search: "",
      timezone: "America/Los_Angeles",
      total,
      filteredTotal: rows.length,
      page: 1,
      pageSize: 25,
      sort: "newest",
      onFilter: () => {},
      onPageChange: () => {},
      onSortChange: () => {},
      enableSelection: true,
    }),
  );
}

describe("AbstractsTable workflow navigation", () => {
  it("shows four workflow views, both notification directions, and a secondary exact-status filter", () => {
    const html = renderTable([ROW], "accept_queue", "ready_to_notify");

    expect(html).toContain('role="group" aria-label="Filter submissions by workflow"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Needs decision, 1 submission" aria-pressed="false"');
    expect(html).toContain('aria-label="Ready to notify, 3 submissions, 2 accept, 1 decline" aria-pressed="true"');
    expect(html).toContain("2 accept</i><i>1 decline");
    expect(html).toContain('role="group" aria-label="Filter current workflow by exact status"');
    expect(html).toContain("All ready to notify");
    expect(html).toContain('data-status="accept_queue"');
    expect(html).toContain('data-status="decline_queue"');
    const statusTabsHtml = html.match(/^<div class="abstract-status-tabs"[\s\S]*?<\/div>/)?.[0];
    expect(statusTabsHtml).toBeDefined();
    expect(statusTabsHtml).not.toContain('class="sr-only"');
  });

  it("derives honest totals for each workflow without replacing exact row statuses", () => {
    expect(abstractWorkflowTabs(COUNTS).map(({ id, count }) => [id, count])).toEqual([
      ["needs_decision", 1],
      ["ready_to_notify", 3],
      ["decided", 3],
      ["all", 7],
    ]);
    expect(renderTable([ROW])).toContain('data-status="pending"');
    const allWorkflowHtml = renderTable([ROW], "all", "all");
    expect(allWorkflowHtml).toContain("All submissions");
    expect(allWorkflowHtml).not.toContain("All all");
    expect(allWorkflowHtml).toContain('data-status="draft"');
  });
});

// An organizer on an event with submissions must never be told there are none:
// the first-run empty state belongs to a genuinely empty event, and every other
// zero-row table has to name the filter that emptied it.
describe("AbstractsTable empty states", () => {
  it("explains an empty workflow tab instead of claiming the event has no submissions", () => {
    const html = renderTable([], "all", "ready_to_notify", 24);

    expect(html).toContain("Nothing is queued for notification");
    expect(html).not.toContain("No submissions yet");
  });

  it("names the exact status that emptied the table, with a way back to the whole tab", () => {
    const html = renderTable([], "withdrawn", "decided", 24);

    expect(html).toContain("Nothing has that status");
    expect(html).toContain("Withdrawn” right now");
    expect(html).not.toContain("No submissions yet");
  });

  it("points a first-run event at the form that has to exist before a submission can arrive", () => {
    const html = renderTable([], "all", "needs_decision", 0);

    expect(html).toContain("No submissions yet");
    expect(html).toContain('href="/events/00000000-0000-4000-8000-000000000001/forms"');
  });
});

// PR #106 Codex finding: the T5 responsive disclosure ladder in globals.css
// (`.data-table th.abstracts-col-*`) targets classes that only exist if
// DataTable actually stamps them from these column definitions — a silent
// desync here would leave the production table scrolling horizontally again
// with no compile-time signal. This pins the four classes the ladder depends
// on to both the header cell and the body cell.
describe("AbstractsTable responsive column hooks", () => {
  it("stamps the abstracts-col-* class DataTable needs onto both th and td, for every T5-hidden column", () => {
    const html = renderTable([ROW]);

    for (const column of ["track", "notified", "submitted", "speakers"]) {
      const className = `abstracts-col-${column}`;
      // One in <thead>, one in <tbody> — a header cell and exactly one row's
      // body cell.
      const occurrences = html.split(`class="${className}"`).length - 1;
      expect(occurrences, `${className} should appear on one <th> and one <td>`).toBe(2);
    }
  });

  it("does not put a disclosure class on the essential columns (code, title, status, rating)", () => {
    const html = renderTable([ROW]);

    expect(html).not.toContain("abstracts-col-code");
    expect(html).not.toContain("abstracts-col-title");
    expect(html).not.toContain("abstracts-col-status");
    expect(html).not.toContain("abstracts-col-rating");
  });

  it("renders the Track cell's chip with the shared track-chip class the ellipsis rule also targets", () => {
    const html = renderTable([ROW]);
    expect(html).toContain('class="abstracts-col-track"');
    // The <td class="abstracts-col-track"> must contain a `.track-chip` for
    // `.data-table td.abstracts-col-track .track-chip` (globals.css) to
    // match — the *second* occurrence is the body cell, the first is the
    // <th>.
    const trackCellIndex = html.lastIndexOf('class="abstracts-col-track"');
    expect(html.slice(trackCellIndex, trackCellIndex + 200)).toContain("track-chip");
  });
});
