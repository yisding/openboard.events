import { describe, expect, it } from "vitest";
import type { DeliverableRowDTO } from "@/shared/contracts";
import {
  dataTableCanSelectAllRows,
  dataTableSelectionCountLabel,
  type DataTableAllRowsSelection,
} from "@/shared/ui/app/data-table";
import { DELIVERABLE_BULK_LIMIT } from "../bulk-limit";
import {
  deliverableBulkTargets,
  deliverableExportSelection,
  fileExportStatusNote,
  filesSelectionBarState,
} from "./files-selection";

const wording: DataTableAllRowsSelection = {
  maxRows: DELIVERABLE_BULK_LIMIT,
  singularNoun: "deliverable",
  pluralNoun: "deliverables",
};

function state(matchingCount: number, selectedCount = 25) {
  const canSelectAllRows = dataTableCanSelectAllRows(matchingCount, wording);
  return {
    canSelectAllRows,
    bar: filesSelectionBarState({
      scope: "page",
      selectedCount,
      pageSelectedCount: 25,
      pageRowCount: 25,
      matchingCount,
      canSelectAllRows,
    }),
  };
}

describe("Files all-filtered selection", () => {
  it("offers an explicit escalation after the current page is selected under the cap", () => {
    const result = state(87);

    expect(result).toEqual({
      canSelectAllRows: true,
      bar: { allMatching: false, canSelectAllMatching: true },
    });
    expect(dataTableSelectionCountLabel(25, "page", wording))
      .toBe("25 deliverables selected on this page");
  });

  it("includes the exact 200-deliverable boundary", () => {
    const before = state(DELIVERABLE_BULK_LIMIT);
    const after = filesSelectionBarState({
      scope: "allRows",
      selectedCount: DELIVERABLE_BULK_LIMIT,
      pageSelectedCount: 25,
      pageRowCount: 25,
      matchingCount: DELIVERABLE_BULK_LIMIT,
      canSelectAllRows: before.canSelectAllRows,
    });

    expect(before.bar.canSelectAllMatching).toBe(true);
    expect(after).toEqual({ allMatching: true, canSelectAllMatching: false });
    expect(dataTableSelectionCountLabel(DELIVERABLE_BULK_LIMIT, "allRows", wording))
      .toBe("200 matching deliverables selected");
  });

  it("stays truthfully page-local immediately above the cap", () => {
    const result = state(DELIVERABLE_BULK_LIMIT + 1);

    expect(result).toEqual({
      canSelectAllRows: false,
      bar: { allMatching: false, canSelectAllMatching: false },
    });
    expect(dataTableSelectionCountLabel(25, "page", wording))
      .toBe("25 deliverables selected on this page");
  });

  it("does not escalate a partially selected page", () => {
    expect(filesSelectionBarState({
      scope: "page",
      selectedCount: 24,
      pageSelectedCount: 24,
      pageRowCount: 25,
      matchingCount: 87,
      canSelectAllRows: true,
    })).toEqual({ allMatching: false, canSelectAllMatching: false });
  });

  it("does not offer a redundant escalation when every match is already on the page", () => {
    expect(filesSelectionBarState({
      scope: "page",
      selectedCount: 12,
      pageSelectedCount: 12,
      pageRowCount: 12,
      matchingCount: 12,
      canSelectAllRows: true,
    })).toEqual({ allMatching: false, canSelectAllMatching: false });
  });

  it("sends only server-revalidated slot coordinates for a full capped batch", () => {
    const rows = Array.from({ length: DELIVERABLE_BULK_LIMIT }, (_, index) => ({
      taskId: `task-${index}`,
      contactId: `contact-${index}`,
      submissionId: index === 0 ? null : `submission-${index}`,
      completed: false,
      latestVersion: null,
    })) as DeliverableRowDTO[];

    const targets = deliverableBulkTargets(rows);
    expect(targets).toHaveLength(DELIVERABLE_BULK_LIMIT);
    expect(targets[0]).toEqual({ taskId: "task-0", contactId: "contact-0", submissionId: null });
    expect(targets[1]).toEqual({ taskId: "task-1", contactId: "contact-1", submissionId: "submission-1" });
    expect(targets[0]).not.toHaveProperty("completed");
    expect(targets[0]).not.toHaveProperty("latestVersion");
  });
});

describe("Files export selection accounting", () => {
  const rows = (uploaded: number, empty: number) => [
    ...Array.from({ length: uploaded }, (_, index) => ({ taskId: `filled-${index}`, latestVersion: { fileUploadId: `u-${index}` } })),
    ...Array.from({ length: empty }, (_, index) => ({ taskId: `empty-${index}`, latestVersion: null })),
  ] as DeliverableRowDTO[];

  it("keeps the rows that can be zipped and counts the ones that cannot", () => {
    const selection = deliverableExportSelection(rows(8, 2));

    expect(selection.exportable).toHaveLength(8);
    expect(selection.exportable.every((row) => row.latestVersion !== null)).toBe(true);
    expect(selection.skippedWithoutUpload).toBe(2);
  });

  it("names the rows a mixed selection left out, while the job runs and once it is ready", () => {
    const skipped = deliverableExportSelection(rows(8, 2)).skippedWithoutUpload;

    expect(fileExportStatusNote({ status: "processing", entryCount: 0, error: null }, skipped))
      .toBe("2 selected deliverables had no file uploaded yet and were left out. This updates automatically.");
    expect(fileExportStatusNote({ status: "completed", entryCount: 8, error: null }, skipped))
      .toBe("8 files zipped · 2 selected deliverables had no file uploaded yet and were left out");
  });

  it("says nothing extra when every selected deliverable had a file", () => {
    const skipped = deliverableExportSelection(rows(3, 0)).skippedWithoutUpload;

    expect(skipped).toBe(0);
    expect(fileExportStatusNote({ status: "completed", entryCount: 3, error: null }, skipped)).toBe("3 files zipped");
    expect(fileExportStatusNote({ status: "pending", entryCount: 0, error: null }, skipped)).toBe("This updates automatically.");
  });

  it("counts a single skipped deliverable in the singular and leaves a failure's own reason alone", () => {
    expect(fileExportStatusNote({ status: "completed", entryCount: 1, error: null }, 1))
      .toBe("1 file zipped · 1 selected deliverable had no file uploaded yet and was left out");
    expect(fileExportStatusNote({ status: "failed", entryCount: 0, error: "That selection is 6 GB" }, 1))
      .toBe("That selection is 6 GB");
  });
});
