import { describe, expect, it } from "vitest";
import type { DeliverableRowDTO } from "@/shared/contracts";
import {
  dataTableCanSelectAllRows,
  dataTableSelectionCountLabel,
  type DataTableAllRowsSelection,
} from "@/shared/ui/app/data-table";
import { DELIVERABLE_BULK_LIMIT } from "../bulk-limit";
import { deliverableBulkTargets, filesSelectionBarState } from "./files-selection";

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
