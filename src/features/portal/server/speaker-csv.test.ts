import { describe, expect, it } from "vitest";
import { parseCsv, readSpeakerCsvRows } from "./speaker-csv";

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
