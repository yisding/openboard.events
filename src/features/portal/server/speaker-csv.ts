import { z } from "zod";
import { SPEAKER_CSV_FIELDS, type SpeakerCsvColumnMapping, type SpeakerCsvField } from "@/shared/contracts";

/**
 * M51 — CSV import for the speaker roster. Pure parsing/validation lives
 * here so it is testable without a database; the read (preview) and write
 * (commit) halves that turn a validated row into a contact live in
 * `speaker-roster-mutations.ts`, both going through the two contacts helpers
 * (resolution #13). `SPEAKER_CSV_FIELDS`/the column-mapping shape live in
 * `@/shared/contracts` — the same type the route's zod input and the client
 * mapping UI both use, so this reader can never drift from what a caller is
 * allowed to send.
 */

/** RFC 4180-ish: `,` separated, `"…"` quoted fields with doubled inner quotes
 * and embedded commas/newlines, `\r\n` or bare `\n` line endings. Trailing
 * blank lines are dropped rather than becoming an all-empty row. */
export function parseCsv(text: string): string[][] {
  // A leading BOM is common from Excel/Sheets exports; strip it before
  // parsing so it never becomes part of the first header cell.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const push = () => { row.push(field); field = ""; };
  const endRow = () => { push(); rows.push(row); row = []; };
  while (i < source.length) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (source[i + 1] === "\"") { field += "\""; i += 2; continue; }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === "\"") { inQuotes = true; i += 1; continue; }
    if (ch === ",") { push(); i += 1; continue; }
    if (ch === "\r") { i += 1; continue; }
    if (ch === "\n") { endRow(); i += 1; continue; }
    field += ch;
    i += 1;
  }
  // A trailing newline already closed the last row via `endRow`; anything
  // still buffered (no final newline, or the file was empty) is one more row
  // — unless it is the single empty field an empty file parses to.
  if (field.length > 0 || row.length > 0) endRow();
  // Trailing only, as documented. Dropping blank rows *anywhere* compacted the
  // array, and `readSpeakerCsvRows` derives its 1-based `rowNumber` from the
  // index of that compacted array — so one blank separator line at row 40 of a
  // 200-row export shifted every reported row number below it by one, and the
  // error CSV an organizer downloads pointed them at the wrong record. An
  // interior blank row is kept here and skipped, still counted, by the reader.
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last && last.length === 1 && last[0] === "") rows.pop();
    else break;
  }
  return rows;
}

/** A row the file contains but that carries no data at all — a separator line. */
function isBlankRow(cells: string[]): boolean {
  return cells.every((cell) => cell.trim() === "");
}

export type SpeakerCsvRowResult = {
  rowNumber: number; // 1-based, counting the header as row 1 (matches what a spreadsheet shows)
  email: string | null;
  values: Partial<Record<SpeakerCsvField, string>>;
  error: string | null;
};

const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/**
 * Parses and shape-validates every data row against the organizer's column
 * mapping. Does not touch the database — duplicate-within-file and
 * already-on-file detection happen in `speaker-roster-mutations.ts`, which
 * has the contacts table to check against. A row with an unparseable email
 * carries `error` and `email: null`; every other row carries its normalized
 * email even if the file has it duplicated, so the caller can report that as
 * its own error kind.
 */
export function readSpeakerCsvRows(rows: string[][], mapping: SpeakerCsvColumnMapping): SpeakerCsvRowResult[] {
  const [, ...dataRows] = rows;
  // Blank separator lines are skipped but still counted, so `rowNumber` keeps
  // meaning what the docstring on the field says: the line a spreadsheet shows.
  return dataRows.flatMap((cells, index): SpeakerCsvRowResult[] => {
    if (isBlankRow(cells)) return [];
    const rowNumber = index + 2; // +1 for the header, +1 to go from 0-based
    const rawEmail = cells[mapping.email]?.trim() ?? "";
    if (!rawEmail) return [{ rowNumber, email: null, values: {}, error: "Missing email" }];
    const parsedEmail = emailSchema.safeParse(rawEmail);
    if (!parsedEmail.success) return [{ rowNumber, email: null, values: {}, error: `Invalid email "${rawEmail}"` }];
    const values: Partial<Record<SpeakerCsvField, string>> = {};
    for (const field of SPEAKER_CSV_FIELDS) {
      const columnIndex = mapping.fields[field];
      if (columnIndex === undefined) continue;
      const raw = cells[columnIndex]?.trim() ?? "";
      if (raw) values[field] = raw;
    }
    return [{ rowNumber, email: parsedEmail.data, values, error: null }];
  });
}
