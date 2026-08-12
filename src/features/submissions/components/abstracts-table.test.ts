import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { contactIdSchema, submissionIdSchema, trackIdSchema } from "@/shared/contracts";
import type { SubmissionListRow, SubmissionStatus } from "@/shared/contracts";
import { AbstractsTable } from "./abstracts-table";

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
  all: 1,
  accepted: 0,
  accept_queue: 0,
  pending: 1,
  decline_queue: 0,
  declined: 0,
  withdrawn: 0,
  draft: 0,
};

function renderTable(rows: SubmissionListRow[], status: SubmissionStatus | "all" = "all"): string {
  return renderToStaticMarkup(
    React.createElement(AbstractsTable, {
      rows,
      counts: COUNTS,
      status,
      search: "",
      timezone: "America/Los_Angeles",
      total: rows.length,
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

describe("AbstractsTable status filter accessibility", () => {
  it("exposes the selected status and gives each tab a complete accessible name without offscreen overflow", () => {
    const html = renderTable([ROW], "pending");

    expect(html).toContain('role="group" aria-label="Filter abstracts by status"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-label="Pending, 1 abstract" aria-pressed="true"[^>]*class="active"[^>]*>Pending <span aria-hidden="true">1<\/span>/);
    expect(html).toContain('aria-label="Accepted, 0 abstracts"');
    const statusTabsHtml = html.match(/^<div class="abstract-status-tabs"[\s\S]*?<\/div>/)?.[0];
    expect(statusTabsHtml).toBeDefined();
    expect(statusTabsHtml).not.toContain('class="sr-only"');
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
