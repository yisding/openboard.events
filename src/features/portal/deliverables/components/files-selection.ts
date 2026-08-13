import type { DeliverableRowDTO } from "@/shared/contracts";
import type { DataTableSelectionScope } from "@/shared/ui/app/data-table";

export type FilesSelectionBarState = {
  allMatching: boolean;
  canSelectAllMatching: boolean;
};

/**
 * Files is the only local-paginated table that opts into a cross-page scope.
 * The shared table has already reduced `scope` back to page-local when the
 * complete filtered set is above the mutation cap.
 */
export function filesSelectionBarState({
  scope,
  selectedCount,
  pageSelectedCount,
  pageRowCount,
  matchingCount,
  canSelectAllRows,
}: {
  scope: DataTableSelectionScope;
  selectedCount: number;
  pageSelectedCount: number;
  pageRowCount: number;
  matchingCount: number;
  canSelectAllRows: boolean;
}): FilesSelectionBarState {
  const allMatching = scope === "allRows"
    && matchingCount > 0
    && selectedCount === matchingCount;
  return {
    allMatching,
    canSelectAllMatching: canSelectAllRows
      && scope === "page"
      && !allMatching
      && selectedCount > 0
      && pageRowCount > 0
      && pageSelectedCount === pageRowCount
      && pageRowCount < matchingCount,
  };
}

/**
 * Both servers re-resolve current eligibility from these slot coordinates:
 * reminders discard completed/ineligible assignments and exports derive the
 * current latest upload. No client-observed file or completion claim crosses
 * the boundary.
 */
export function deliverableBulkTargets(rows: readonly DeliverableRowDTO[]) {
  return rows.map((row) => ({
    taskId: row.taskId,
    contactId: row.contactId,
    submissionId: row.submissionId,
  }));
}
