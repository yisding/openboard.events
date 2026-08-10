import { describe, expect, it } from "vitest";
import type { SubmissionListRow } from "@/shared/contracts";
import { submissionCsvColumns, toCsv, type CsvColumn } from "./csv";

/**
 * The spec for `toCsv`/`SUBMISSION_CSV_COLUMNS` — see M20 work order step 2.
 * Every hostile string here is drawn straight from the "Done when" test
 * corpus: `;lkj`, `a,b`, an embedded quote, an embedded newline, an
 * Excel/Sheets formula-injection payload, a 255-char title, RTL text and an
 * `<img onerror>` payload.
 */

type Row = { name: string; note: string | number | null | undefined };
const rows = (get: Row[]): Row[] => get;
const cols: readonly CsvColumn<Row>[] = [
  { header: "Name", get: (row) => row.name },
  { header: "Note", get: (row) => row.note },
];

function baseRow(overrides: Partial<SubmissionListRow> = {}): SubmissionListRow {
  return {
    submissionId: "10000000-0000-4000-8000-000000000001" as SubmissionListRow["submissionId"],
    code: 101,
    status: "accepted",
    source: "cfp",
    formId: "10000000-0000-4000-8000-000000000002" as SubmissionListRow["formId"],
    formName: "Technical Talks",
    title: "Caching at the edge",
    descriptionPlain: "Fast pages",
    submitterEmail: "ada@example.com",
    submitterName: "Ada Lovelace",
    speakers: [{ contactId: "10000000-0000-4000-8000-000000000003" as SubmissionListRow["speakers"][number]["contactId"], name: "Ada Lovelace", isPrimary: true }],
    trackId: "10000000-0000-4000-8000-000000000004" as SubmissionListRow["trackId"],
    trackName: "Platforms",
    trackColor: "#6958d7",
    tags: [{ id: "10000000-0000-4000-8000-000000000005" as SubmissionListRow["tags"][number]["id"], name: "Evals" }],
    rating: 4.5,
    nScores: 3,
    notifiedAt: "2026-01-05T12:00:00.000Z",
    submittedAt: "2026-01-01T08:30:00.000Z",
    createdAt: "2025-12-30T00:00:00.000Z",
    formatName: "Workshop",
    language: "English",
    level: "Intermediate",
    capacity: 40,
    clientSessionId: "abc-123",
    rowVersion: 1,
    ...overrides,
  };
}

describe("toCsv — RFC 4180", () => {
  it("separates fields with commas and records with CRLF, including a trailing CRLF", () => {
    const csv = toCsv(rows([{ name: "Ada", note: "hi" }, { name: "Grace", note: "bye" }]), cols);
    expect(csv).toBe("Name,Note\r\nAda,hi\r\nGrace,bye\r\n");
  });

  it("passes an unquoted hostile-but-plain string through untouched", () => {
    const csv = toCsv(rows([{ name: ";lkj", note: null }]), cols);
    expect(csv).toBe("Name,Note\r\n;lkj,\r\n");
  });

  it("quotes a field containing a comma", () => {
    const csv = toCsv(rows([{ name: "a,b", note: null }]), cols);
    expect(csv).toBe("Name,Note\r\n\"a,b\",\r\n");
  });

  it("doubles an embedded quote and wraps the field in quotes", () => {
    const csv = toCsv(rows([{ name: "he said \"hi\"", note: null }]), cols);
    expect(csv).toBe("Name,Note\r\n\"he said \"\"hi\"\"\",\r\n");
  });

  it("keeps a newline inside a description inside quotes, without splitting the record", () => {
    const csv = toCsv(rows([{ name: "desc", note: "line1\nline2" }]), cols);
    expect(csv).toBe("Name,Note\r\ndesc,\"line1\nline2\"\r\n");
    // Exactly one data record: splitting on the record separator gives the
    // header, the one (internally multi-line) record, and the trailing empty
    // segment — proof the embedded `\n` did not start a second record.
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("renders null and undefined as an empty field, never the string \"null\"", () => {
    const csv = toCsv(rows([{ name: "x", note: null }, { name: "y", note: undefined }]), cols);
    expect(csv).toBe("Name,Note\r\nx,\r\ny,\r\n");
  });

  it("quotes a field with a leading or trailing space", () => {
    const csv = toCsv(rows([{ name: " leading", note: "trailing " }]), cols);
    expect(csv).toBe("Name,Note\r\n\" leading\",\"trailing \"\r\n");
  });

  it("round-trips a 255-char title without truncation", () => {
    const long = "x".repeat(255);
    const csv = toCsv(rows([{ name: long, note: null }]), cols);
    expect(csv).toContain(long);
    expect(csv.split("\r\n")[1]).toBe(`${long},`);
  });

  it("passes RTL text through as literal UTF-8 text", () => {
    const rtl = "مرحبا بالعالم"; // "Hello world" in Arabic
    const csv = toCsv(rows([{ name: rtl, note: null }]), cols);
    expect(csv).toContain(rtl);
  });

  it("does not treat an HTML/script payload as anything but literal text", () => {
    const payload = "<img src=x onerror=alert(1)>";
    const csv = toCsv(rows([{ name: payload, note: null }]), cols);
    expect(csv).toBe(`Name,Note\r\n${payload},\r\n`);
  });

  it("handles an empty row set as a header-only file", () => {
    expect(toCsv([], cols)).toBe("Name,Note\r\n");
  });
});

describe("toCsv — CSV-injection guard", () => {
  it.each([
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    ["+1+1", "'+1+1"],
    ["-1+1", "'-1+1"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\ttabbed", "'\ttabbed"],
  ])("prefixes a leading %s with a defusing single quote", (input, expected) => {
    const csv = toCsv(rows([{ name: input, note: null }]), cols);
    // The guard fires before the quoting decision, so a payload with no comma/
    // quote/CR/LF of its own stays unquoted apart from the leading `'`.
    expect(csv.split("\r\n")[1]).toBe(`${expected},`);
  });

  it("does not prefix a field that merely contains, but does not start with, a guarded character", () => {
    const csv = toCsv(rows([{ name: "total=5", note: null }]), cols);
    expect(csv.split("\r\n")[1]).toBe("total=5,");
  });

  it("guards a field that also needs quoting for an embedded comma", () => {
    const csv = toCsv(rows([{ name: "=A1,B1", note: null }]), cols);
    expect(csv.split("\r\n")[1]).toBe("\"'=A1,B1\",");
  });
});

describe("submissionCsvColumns — golden header row", () => {
  it("asserts the exact 20-column header, in catalog order, with the event zone named on every instant column", () => {
    const header = submissionCsvColumns("America/Los_Angeles").map((column) => column.header);
    expect(header).toEqual([
      "Code",
      "Status",
      "Source",
      "Title",
      "Description",
      "Submitter Email",
      "Speakers",
      "Track",
      "Tags",
      "Format",
      "Language",
      "Level",
      "Rating",
      "Reviews",
      "Capacity",
      "Client Session ID",
      "Submitted At (America/Los_Angeles)",
      "Decided At (America/Los_Angeles)",
      "Notified At (America/Los_Angeles)",
      "Created At (America/Los_Angeles)",
    ]);
  });

  it("names a different event's zone in its own header", () => {
    const header = submissionCsvColumns("Asia/Singapore").map((column) => column.header);
    expect(header).toContain("Submitted At (Asia/Singapore)");
  });
});

describe("submissionCsvColumns — row rendering", () => {
  const columns = submissionCsvColumns("America/Los_Angeles");
  function get(header: string, row: SubmissionListRow) {
    const column = columns.find((candidate) => candidate.header.startsWith(header));
    if (!column) throw new Error(`No CSV column found for header "${header}"`);
    return column.get(row);
  }

  it("renders the code as SESS-n", () => {
    expect(get("Code", baseRow({ code: 42 }))).toBe("SESS-42");
  });

  it("labels a CFP submission's source with the form's internal name", () => {
    expect(get("Source", baseRow({ source: "cfp", formName: "Technical Talks" }))).toBe("Technical Talks");
  });

  it("labels a manually-added submission's source as Manual", () => {
    expect(get("Source", baseRow({ source: "manual" }))).toBe("Manual");
  });

  it("labels an imported submission's source as Import", () => {
    expect(get("Source", baseRow({ source: "import" }))).toBe("Import");
  });

  it("joins speakers with '; ', primary first, in sort_order — as the row already arrives", () => {
    const row = baseRow({
      speakers: [
        { contactId: "10000000-0000-4000-8000-000000000010" as SubmissionListRow["speakers"][number]["contactId"], name: "Grace Hopper", isPrimary: true },
        { contactId: "10000000-0000-4000-8000-000000000011" as SubmissionListRow["speakers"][number]["contactId"], name: "Ada Lovelace", isPrimary: false },
      ],
    });
    expect(get("Speakers", row)).toBe("Grace Hopper; Ada Lovelace");
  });

  it("joins tags with '; '", () => {
    const row = baseRow({
      tags: [
        { id: "10000000-0000-4000-8000-000000000012" as SubmissionListRow["tags"][number]["id"], name: "Evals" },
        { id: "10000000-0000-4000-8000-000000000013" as SubmissionListRow["tags"][number]["id"], name: "Tooling" },
      ],
    });
    expect(get("Tags", row)).toBe("Evals; Tooling");
  });

  it("renders rating to one decimal, empty when unrated", () => {
    expect(get("Rating", baseRow({ rating: 4 }))).toBe("4.0");
    expect(get("Rating", baseRow({ rating: null }))).toBeNull();
  });

  it("renders nullable columns as null (an empty field), never the string 'null'", () => {
    const row = baseRow({ trackName: null, formatName: null, language: null, level: null, capacity: null, clientSessionId: null, submitterEmail: null });
    expect(get("Track", row)).toBeNull();
    expect(get("Format", row)).toBeNull();
    expect(get("Language", row)).toBeNull();
    expect(get("Level", row)).toBeNull();
    expect(get("Capacity", row)).toBeNull();
    expect(get("Client Session ID", row)).toBeNull();
    expect(get("Submitter Email", row)).toBeNull();
  });

  it("formats every instant column as yyyy-MM-dd HH:mm in the event's zone", () => {
    const row = baseRow({ submittedAt: "2026-01-01T08:30:00.000Z", notifiedAt: "2026-01-05T20:15:00.000Z", createdAt: "2025-12-30T00:00:00.000Z" });
    expect(get("Submitted At", row)).toBe("2026-01-01 00:30");
    expect(get("Notified At", row)).toBe("2026-01-05 12:15");
    expect(get("Created At", row)).toBe("2025-12-29 16:00");
  });

  it("leaves Submitted At / Notified At empty (not \"null\") when the submission hasn't reached that stage", () => {
    const row = baseRow({ submittedAt: null, notifiedAt: null });
    expect(get("Submitted At", row)).toBeNull();
    expect(get("Notified At", row)).toBeNull();
  });

  it("leaves Decided At empty — not exposed by listSubmissions's row shape, so no second query is written to fetch it", () => {
    expect(get("Decided At", baseRow())).toBeNull();
  });

  it("carries an HTML-stripped description through untouched by toCsv's own escaping, newlines intact", () => {
    const row = baseRow({ descriptionPlain: "line one\nline two <not a tag, already stripped upstream>" });
    expect(get("Description", row)).toBe(row.descriptionPlain);
  });
});
