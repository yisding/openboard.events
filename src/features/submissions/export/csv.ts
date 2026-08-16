import { eventDayKey, hourMinuteInZone } from "@/shared/lib/time";
import { formatCode } from "@/features/submissions/server/guards";
import { statusBadgeLabel } from "@/shared/ui/status-badge";
import type { SubmissionListRow } from "@/shared/contracts";

/**
 * A single exported column: a header cell and a pure accessor over the row
 * type. Kept generic (not submissions-specific) so `toCsv` stays testable
 * with plain fixtures and has zero DB/time dependency of its own.
 */
export type CsvColumn<T> = { header: string; get: (row: T) => string | number | null | undefined };

// CSV-injection guard (documented decision, see M20 work order): a field
// opening with one of these characters is a formula (or a control character
// Excel/Sheets treats as one) to the spreadsheet that opens it. Public CFP
// input flows straight into this file, so a leading `=`, `+`, `-`, `@`, tab
// or CR gets a defusing leading `'` before quoting — the same trust boundary
// as the XSS sanitizer, just for a different execution engine.
const INJECTION_LEAD_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let field = typeof value === "number" ? String(value) : value;
  if (field.length > 0 && INJECTION_LEAD_CHARS.has(field.charAt(0))) field = `'${field}`;
  const needsQuoting = field.includes(",") || field.includes("\"") || field.includes("\r") || field.includes("\n")
    || field.startsWith(" ") || field.endsWith(" ");
  return needsQuoting ? `"${field.replace(/"/g, "\"\"")}"` : field;
}

/**
 * RFC 4180 serialization: `,` field separator, `\r\n` record separator
 * (including after the final row, so a naive `wc -l` count is header + rows),
 * doubled inner quotes, and the injection guard above. Deliberately BOM-less
 * — the BOM is a byte the route prepends, not something a pure string
 * function should know about.
 */
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((column) => csvField(column.header)).join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvField(column.get(row))).join(","));
  return lines.map((line) => `${line}\r\n`).join("");
}

/** `yyyy-MM-dd HH:mm` in the event's zone, built only from `time.ts` primitives
 *  (no direct date-fns import here — CI grep #4 confines that to `time.ts`). */
function formatCsvInstant(iso: string, timeZone: string): string {
  const { hour, minute } = hourMinuteInZone(iso, timeZone);
  return `${eventDayKey(iso, timeZone)} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function sourceLabel(row: SubmissionListRow): string {
  if (row.source === "manual") return "Manual";
  if (row.source === "import") return "Import";
  return row.formName ?? "CFP";
}

/**
 * The fixed Abstracts export column set, in the catalog's order. A factory
 * rather than a plain constant: every timestamp column names the event's IANA
 * zone in its own header (`Submitted At (America/Los_Angeles)`) so the file
 * never drifts to a reader's local time once it is emailed around, and that
 * zone is only known per event, not at module load.
 *
 * "Decided At" is part of the catalog's column list but `SubmissionListRow`
 * (M17's `listSubmissions` shape) does not carry `decidedAt` today. Rather
 * than add a second SQL statement to fetch it — the one-query guardrail this
 * module is built around — the column stays present with an empty value
 * until that field is added upstream.
 */
export function submissionCsvColumns(timeZone: string): readonly CsvColumn<SubmissionListRow>[] {
  return [
    { header: "Code", get: (row) => formatCode(row.code) },
    // The export is a human artifact — codes read `SESS-42`, sources read
    // "Manual" — so the status column speaks the Abstracts table's vocabulary
    // too. A forwarded file never says `accept_queue`.
    { header: "Status", get: (row) => statusBadgeLabel(row.status) },
    { header: "Source", get: sourceLabel },
    { header: "Title", get: (row) => row.title },
    { header: "Description", get: (row) => row.descriptionPlain },
    { header: "Submitter Email", get: (row) => row.submitterEmail },
    { header: "Speakers", get: (row) => row.speakers.map((speaker) => speaker.name).join("; ") },
    { header: "Track", get: (row) => row.trackName },
    { header: "Tags", get: (row) => row.tags.map((tag) => tag.name).join("; ") },
    { header: "Format", get: (row) => row.formatName },
    { header: "Language", get: (row) => row.language },
    { header: "Level", get: (row) => row.level },
    { header: "Rating", get: (row) => (row.rating === null ? null : row.rating.toFixed(1)) },
    { header: "Reviews", get: (row) => row.nScores },
    { header: "Capacity", get: (row) => row.capacity },
    { header: "Client Session ID", get: (row) => row.clientSessionId },
    { header: `Submitted At (${timeZone})`, get: (row) => (row.submittedAt ? formatCsvInstant(row.submittedAt, timeZone) : null) },
    { header: `Decided At (${timeZone})`, get: () => null },
    { header: `Notified At (${timeZone})`, get: (row) => (row.notifiedAt ? formatCsvInstant(row.notifiedAt, timeZone) : null) },
    { header: `Created At (${timeZone})`, get: (row) => formatCsvInstant(row.createdAt, timeZone) },
  ];
}
