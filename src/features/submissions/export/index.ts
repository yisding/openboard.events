import { db, type DbOrTx } from "@/db/client";
import { getEventIn } from "@/features/events";
import { listSubmissionsIn } from "@/features/submissions/server/queries";
import type { SubmissionFilters } from "@/features/submissions/server/filters";
import type { EventId } from "@/shared/contracts";
import { AppError } from "@/shared/lib/errors";
import { submissionCsvColumns, toCsv } from "./csv";

export type { CsvColumn } from "./csv";
export { submissionCsvColumns, toCsv } from "./csv";

/** A runaway export must not blow the Worker's CPU/memory budget. */
const EXPORT_ROW_CAP = 5000;
/** The internal paging step while walking `listSubmissions` — the schema's own cap on `pageSize`. */
const EXPORT_PAGE_SIZE = 200;

export type ExportSubmissionsCsvResult = {
  /** The serialized file body — BOM-less; the route prepends the BOM byte. */
  csv: string;
  /** True once the 5000-row cap stopped the walk before every matching row was included. */
  truncated: boolean;
  rowCount: number;
  event: { slug: string; timezone: string };
};

/**
 * Walks `listSubmissions` page by page — the exact same query, filters and
 * ordering the Abstracts table renders — until every matching row has been
 * collected or the export cap is hit. This is deliberately the only place in
 * the export feature that talks to the database: a second SQL statement here
 * is how the file quietly stops matching what is on screen.
 */
export async function exportSubmissionsCsvIn(
  dbOrTx: DbOrTx,
  eventId: EventId,
  filters: SubmissionFilters,
): Promise<ExportSubmissionsCsvResult> {
  const event = await getEventIn(dbOrTx, eventId);
  if (!event) throw new AppError("NOT_FOUND", "Event not found");

  const rows: Awaited<ReturnType<typeof listSubmissionsIn>>["rows"] = [];
  let page = 1;
  let total = 0;

  for (;;) {
    const result = await listSubmissionsIn(dbOrTx, eventId, { ...filters, page, pageSize: EXPORT_PAGE_SIZE });
    total = result.total;
    if (result.rows.length === 0) break;
    rows.push(...result.rows);
    if (rows.length >= total || rows.length >= EXPORT_ROW_CAP) break;
    page += 1;
  }

  // Truncation is a property of the filtered total versus the cap, not of
  // where the cap happened to land relative to a page boundary — a total
  // that is an exact multiple of the page size must still be flagged.
  const truncated = total > EXPORT_ROW_CAP;
  const cappedRows = truncated ? rows.slice(0, EXPORT_ROW_CAP) : rows;

  return {
    csv: toCsv(cappedRows, submissionCsvColumns(event.timezone)),
    truncated,
    rowCount: cappedRows.length,
    event: { slug: event.slug, timezone: event.timezone },
  };
}

export function exportSubmissionsCsv(eventId: EventId, filters: SubmissionFilters): Promise<ExportSubmissionsCsvResult> {
  return exportSubmissionsCsvIn(db, eventId, filters);
}
