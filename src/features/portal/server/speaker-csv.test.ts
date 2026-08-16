import { describe, expect, it } from "vitest";
import { applyCsvCellEdits, parseCsv, readSpeakerCsvRows } from "./speaker-csv";

describe("parseCsv", () => {
  it("splits a simple comma-separated file into rows and cells", () => {
    const rows = parseCsv("email,first\r\nada@example.com,Ada\r\n");
    expect(rows).toEqual([["email", "first"], ["ada@example.com", "Ada"]]);
  });

  it("handles quoted fields with embedded commas, quotes and newlines", () => {
    const rows = parseCsv('email,bio\r\nada@example.com,"Loves ""AI"", and\nnewlines, too"\r\n');
    expect(rows).toEqual([
      ["email", "bio"],
      ["ada@example.com", 'Loves "AI", and\nnewlines, too'],
    ]);
  });

  it("tolerates a missing trailing newline", () => {
    const rows = parseCsv("email\r\nada@example.com");
    expect(rows).toEqual([["email"], ["ada@example.com"]]);
  });

  it("strips a leading UTF-8 BOM", () => {
    const rows = parseCsv("﻿email\r\nada@example.com\r\n");
    expect(rows[0]).toEqual(["email"]);
  });

  it("drops trailing blank lines rather than producing an empty row", () => {
    const rows = parseCsv("email\r\nada@example.com\r\n\r\n");
    expect(rows).toEqual([["email"], ["ada@example.com"]]);
  });

  it("parses an empty file as zero rows", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("keeps a blank line in the middle, which is what row numbering counts", () => {
    // Dropping blanks *anywhere* compacted the array, and `readSpeakerCsvRows`
    // derives its 1-based `rowNumber` from that compacted index.
    expect(parseCsv("email\r\nada@example.com\r\n\r\ngrace@example.com\r\n")).toEqual([
      ["email"], ["ada@example.com"], [""], ["grace@example.com"],
    ]);
  });
});

describe("readSpeakerCsvRows", () => {
  const mapping = { email: 0, fields: { firstName: 1, company: 2 } };

  it("maps mapped columns onto known fields and normalizes email", () => {
    const table = [
      ["Email", "First name", "Company"],
      ["  Ada@Example.com  ", "Ada", "Acme"],
    ];
    const [row] = readSpeakerCsvRows(table, mapping);
    expect(row).toEqual({ rowNumber: 2, email: "ada@example.com", values: { firstName: "Ada", company: "Acme" }, error: null });
  });

  it("flags a missing email without touching any values", () => {
    const table = [["Email", "First name"], ["", "Ada"]];
    const [row] = readSpeakerCsvRows(table, { email: 0, fields: {} });
    expect(row).toEqual({ rowNumber: 2, email: null, values: {}, error: "Missing email" });
  });

  it("flags an unparseable email", () => {
    const table = [["Email"], ["not-an-email"]];
    const [row] = readSpeakerCsvRows(table, { email: 0, fields: {} });
    expect(row?.error).toBe('Invalid email "not-an-email"');
    expect(row?.email).toBeNull();
  });

  it("skips blank mapped cells rather than writing empty strings", () => {
    const table = [["Email", "Company"], ["ada@example.com", "  "]];
    const [row] = readSpeakerCsvRows(table, { email: 0, fields: { company: 1 } });
    expect(row?.values).toEqual({});
  });

  it("counts row numbers as a spreadsheet would (header is row 1)", () => {
    const table = [["Email"], ["a@example.com"], ["b@example.com"]];
    const rows = readSpeakerCsvRows(table, { email: 0, fields: {} });
    expect(rows.map((row) => row.rowNumber)).toEqual([2, 3]);
  });
});

describe("readSpeakerCsvRows row numbering", () => {
  it("keeps reporting the line a spreadsheet shows when the file has a blank separator", () => {
    // One blank separator used to shift every reported row number below it by
    // one, so "Row 3: Invalid email" pointed the organizer at row 4's data —
    // in the preview table and in the error CSV they download.
    const rows = parseCsv("email\r\nada@example.com\r\n\r\nnot-an-email\r\n");
    const parsed = readSpeakerCsvRows(rows, { email: 0, fields: {} });

    expect(parsed.map((row) => row.rowNumber)).toEqual([2, 4]);
    expect(parsed[1]?.error).toBe('Invalid email "not-an-email"');
  });
});

describe("applyCsvCellEdits", () => {
  const file = "email,first\r\nada@example.com,Ada\r\nnot-an-email,Grace\r\n";

  it("rewrites only the corrected row's mapped column, in the row numbering the preview reports", () => {
    const fixed = applyCsvCellEdits(file, 0, { 3: "grace@example.com" });

    expect(readSpeakerCsvRows(parseCsv(fixed), { email: 0, fields: { firstName: 1 } })).toEqual([
      { rowNumber: 2, email: "ada@example.com", values: { firstName: "Ada" }, error: null },
      { rowNumber: 3, email: "grace@example.com", values: { firstName: "Grace" }, error: null },
    ]);
  });

  it("keeps a blank separator line in place, so later corrections still land on the row the organizer pointed at", () => {
    const withBlank = "email\r\nada@example.com\r\n\r\nnot-an-email\r\n";
    const fixed = applyCsvCellEdits(withBlank, 0, { 4: "grace@example.com" });

    expect(readSpeakerCsvRows(parseCsv(fixed), { email: 0, fields: {} })).toEqual([
      { rowNumber: 2, email: "ada@example.com", values: {}, error: null },
      { rowNumber: 4, email: "grace@example.com", values: {}, error: null },
    ]);
  });

  it("quotes a correction that would otherwise break the file, and never edits the header", () => {
    const fixed = applyCsvCellEdits(file, 0, { 1: "hacked", 3: 'a"b,c@example.com' });

    expect(parseCsv(fixed)[0]).toEqual(["email", "first"]);
    expect(parseCsv(fixed)[2]).toEqual(['a"b,c@example.com', "Grace"]);
  });

  it("pads a short row rather than shifting its other cells", () => {
    const ragged = "first,email\r\nAda\r\n";
    const fixed = applyCsvCellEdits(ragged, 1, { 2: "ada@example.com" });

    expect(parseCsv(fixed)[1]).toEqual(["Ada", "ada@example.com"]);
  });

  it("returns the file untouched when there is nothing to apply", () => {
    expect(applyCsvCellEdits(file, 0, {})).toBe(file);
  });
});
