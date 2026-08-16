import type { DeliverableRowDTO, FileExportJobDTO } from "@/shared/contracts";
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

/**
 * A ZIP can only hold slots that have a file. Organizers select *rows*, so a
 * selection routinely mixes in slots nobody has uploaded to yet, and both this
 * view and `createFileExportJobIn` drop them. Splitting the selection here
 * keeps the dropped count as a number the view can say out loud, instead of an
 * archive that is quietly shorter than the selection that asked for it.
 */
export function deliverableExportSelection(rows: readonly DeliverableRowDTO[]): {
  exportable: DeliverableRowDTO[];
  skippedWithoutUpload: number;
} {
  const exportable = rows.filter((row) => row.latestVersion !== null);
  return { exportable, skippedWithoutUpload: rows.length - exportable.length };
}

function skippedDeliverablesNote(skipped: number): string | null {
  if (skipped <= 0) return null;
  return skipped === 1
    ? "1 selected deliverable had no file uploaded yet and was left out"
    : `${skipped} selected deliverables had no file uploaded yet and were left out`;
}

/**
 * The line under the export banner's heading. It carries the skipped count for
 * the whole life of the job — while it is preparing as well as once it is
 * ready — because the gap between "10 selected" and "8 zipped" is exactly the
 * thing the organizer would otherwise have to discover by unzipping.
 */
export function fileExportStatusNote(
  job: Pick<FileExportJobDTO, "status" | "entryCount" | "error">,
  skippedWithoutUpload: number,
): string {
  if (job.status === "failed") {
    return job.error ?? "The export could not be prepared. Use the export menu to try again.";
  }
  const skipped = skippedDeliverablesNote(skippedWithoutUpload);
  if (job.status === "completed") {
    const zipped = `${job.entryCount} file${job.entryCount === 1 ? "" : "s"} zipped`;
    return skipped ? `${zipped} · ${skipped}` : zipped;
  }
  return skipped ? `${skipped}. This updates automatically.` : "This updates automatically.";
}
