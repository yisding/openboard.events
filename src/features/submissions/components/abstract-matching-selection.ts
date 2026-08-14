import { BULK_DECISION_LIMIT } from "../bulk-decision-limit";

export type AbstractSelectionScope = {
  countLabel: string;
  allMatching: boolean;
  selectAllMatchingCount: number | null;
};

/**
 * Escalation is deliberately offered only after every row on the current
 * page is selected. It remains page-local above the transition endpoint's
 * bound, and derives "all matching" only from the freshly rendered server
 * total rather than assuming the count that initiated navigation stayed true.
 */
export function abstractSelectionScope({
  selectedCount,
  pageRowCount,
  filteredTotal,
}: {
  selectedCount: number;
  pageRowCount: number;
  filteredTotal: number;
}): AbstractSelectionScope {
  const allMatching = filteredTotal > 0
    && selectedCount === filteredTotal
    && pageRowCount === filteredTotal;
  const pageIsFullySelected = selectedCount > 0 && selectedCount === pageRowCount;
  const canSelectAllMatching = pageIsFullySelected
    && pageRowCount < filteredTotal
    && filteredTotal <= BULK_DECISION_LIMIT;

  return {
    countLabel: allMatching
      ? `${selectedCount} matching ${selectedCount === 1 ? "submission" : "submissions"} selected`
      : `${selectedCount} ${selectedCount === 1 ? "submission" : "submissions"} selected on this page`,
    allMatching,
    selectAllMatchingCount: canSelectAllMatching ? filteredTotal : null,
  };
}

/**
 * Requests one authoritative server page containing the complete bounded
 * match set, then reuses AbstractsView's one-shot `arm=1` selection path.
 * Every active filter and sort survives; a later server count above the bound
 * simply results in a truthful 200-row page-local selection.
 */
export function abstractAllMatchingHref(
  current: Pick<URLSearchParams, "toString">,
  filteredTotal: number,
): string | null {
  if (!Number.isInteger(filteredTotal) || filteredTotal < 1 || filteredTotal > BULK_DECISION_LIMIT) return null;
  const query = new URLSearchParams(current.toString());
  query.delete("page");
  query.set("pageSize", String(BULK_DECISION_LIMIT));
  query.set("arm", "1");
  return `?${query.toString()}`;
}
