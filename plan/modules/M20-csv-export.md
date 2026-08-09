# M20 — CSV export

| | |
|---|---|
| **Status** | IN PROGRESS — PR #2 includes a **STACK-DEMO** CSV path and injection guard; the dedicated serializer contract/test matrix and database-backed export AC require reconciliation. See [`../status.md`](../status.md). |
| **Workstream / executing agent** | WS-C · Submissions Review (single agent; catalog section WS-C, PLAN §6) |
| **Scheduled** | **Tue** (moved to Tue in PLAN §4/§7; nothing gates on it). |
| **Size** | S (~2h) |
| **Paths owned** | `src/features/submissions/export/csv.ts` · `src/features/submissions/export/csv.test.ts` · `src/features/submissions/export/index.ts` · `src/app/api/internal/submissions/[eventId]/export.csv/route.ts` · the Options-menu item inside `src/features/submissions/components/abstracts-toolbar.tsx` (M17-owned file; append one menu entry — same WS-C agent, sequential) · one appended `export * from './export/index'` line in `src/features/submissions/index.ts` |

## Objective

The "… Options → Export .CSV" menu item on Program → Abstracts downloads exactly the rows currently on screen — same filters, same search, same sort, all pages — as a spreadsheet-safe CSV. Hostile seed data (`;lkj`, commas, quotes, newlines inside descriptions, 255-char titles, RTL text, `<img onerror>`) round-trips into Excel/Sheets without breaking columns or executing anything. Import is explicitly **not** built (cut-line #2).

## Dependencies

**Hard (blocks start):**
- [M17](./M17-abstracts-table.md) — `listSubmissions(eventId, filters)` and the `submissionFiltersSchema` from `src/features/submissions/server/filters.ts`. The export **must** reuse both so the file matches the view.
- [M04](./M04-shared-libs.md) — `defineHandler`, `time.ts` (`formatInZone`), `limits.ts` plaintext/strip-tags helper.
- [M06a](./M06a-admin-auth.md) — `requireAdmin(eventId)`.

**Soft (start against stub/fixture):**
- [M19](./M19-evaluation-scoring.md) — the Rating column. If no plan exists, the Rating cell is empty; no blocking.
- [M09](./M09-seed-demo-script.md) — the hostile seed rows are the test corpus. Until seeded, use the fixture rows in `src/features/submissions/fixtures.ts`.

## Provides (interfaces others consume)

```ts
// src/features/submissions/export/csv.ts  (pure — unit-tested, no DB)
export type CsvColumn<T> = { header: string; get: (row: T) => string | number | null | undefined };
export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string;  // RFC 4180, CRLF, BOM-less
export const SUBMISSION_CSV_COLUMNS: readonly CsvColumn<SubmissionListRow>[];            // the fixed export column set

// src/features/submissions/export/index.ts
export async function exportSubmissionsCsv(eventId: EventId, filters: SubmissionFilters): Promise<string>;
```

Route: `GET /api/internal/submissions/[eventId]/export.csv?<same query string as the table>` → `200 text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="abstracts-<eventSlug>-<yyyy-MM-dd>.csv"`, body = `﻿` + CSV (BOM added at the route, not in `toCsv`, so the pure function stays testable).

**PROPOSED:** the catalog writes the path as `GET /api/internal/submissions/export.csv`; the eventId segment is added because `defineHandler` resolves eventId from the route (R4) — every other internal route in the repo has it.

**Consumers:** the Options menu in [M17](./M17-abstracts-table.md)'s toolbar. Nothing else imports this module; [M39](./M39-airtable-export.md) has its own serializers and must **not** reuse `SUBMISSION_CSV_COLUMNS`.

## Step-by-step implementation

1. **Contract-first slice.** `export/csv.ts` + `export/index.ts` with the signatures above (`toCsv` real, `exportSubmissionsCsv` a stub), and the barrel line. Write `csv.test.ts` first — it is the spec.
   **Done when:** `pnpm tsc --noEmit` is green and `pnpm vitest run src/features/submissions/export/csv.test.ts` runs (red is fine at this point).

2. **`toCsv` — RFC 4180, defensively.** Rules, each with a test row:
   - fields are separated by `,`, records by `\r\n`;
   - a field is quoted iff it contains `,`, `"`, `\r`, `\n` or a leading/trailing space; inner `"` doubled;
   - `null`/`undefined` → empty field (never the string `null`);
   - newlines inside a description are preserved **inside quotes** (they must not split the record);
   - **CSV-injection guard:** a field whose first character is `=`, `+`, `-`, `@`, tab or CR is prefixed with a single quote `'` before quoting (documented decision — spreadsheet formula execution from attacker-controlled CFP input is the same class as the XSS trap).
   **Done when:** the test table covers `;lkj`, `a,b`, `he said "hi"`, `line1\nline2`, `=cmd|' /C calc'!A0`, a 255-char title, an RTL string and `<img src=x onerror=alert(1)>`; all pass.

3. **Column set.** `SUBMISSION_CSV_COLUMNS`, in this order: `Code` (`SESS-n`), `Status`, `Source` (form internal name / `Manual` / `Import`), `Title`, `Description` (HTML **stripped to plaintext** via the shared helper, newlines preserved), `Submitter Email`, `Speakers` (names joined `"; "` in `sort_order`, primary first), `Track`, `Tags` (joined `"; "`), `Format`, `Language`, `Level`, `Rating` (1 decimal or empty), `Reviews` (n), `Capacity`, `Client Session ID`, `Submitted At`, `Decided At`, `Notified At`, `Created At`.
   All instants render via `formatInZone(v, event.timezone, 'yyyy-MM-dd HH:mm')` **plus** the zone label in the header (`Submitted At (America/Los_Angeles)`) — one rule, no viewer-local drift in a file that gets emailed around.
   **Done when:** a golden-file test asserts the exact header row.

4. **`exportSubmissionsCsv`.** Parse filters with `submissionFiltersSchema`, force `pageSize` to the export cap and iterate pages from `listSubmissions` until exhausted or **5000 rows** (then stop and append no partial row; the route sets `X-Export-Truncated: true`). Reuse M17's query — do not write a second SQL statement, or the file will silently diverge from the screen.
   **Done when:** exporting with `?status=pending&trackIds=<id>` produces exactly the row count the Pending tab shows for that track filter.

5. **Route handler.** `defineHandler({ auth: adminAuth() })`, streams the string with the headers above. Filename uses the event slug and today's date in the event tz.
   **Done when:** `curl -sD- "$BASE/api/internal/submissions/$EVENT_ID/export.csv?status=all" -b admin.cookie -o /tmp/x.csv | grep -i 'content-disposition'` shows the attachment header and `wc -l /tmp/x.csv` matches the All count + 1.

6. **Toolbar wiring.** Add `Export .CSV` to M17's "… Options" dropdown (the Sessionboard menu also lists Import Sessions / Export .XLSX / Download files bundle — **do not** build those; cut-line #2). The item is a plain `<a href>` carrying the current filter query string so the browser downloads directly (no fetch/blob dance).
   **Done when:** clicking Export on the Decline Queue tab downloads a file containing only decline-queue rows.

7. **Spreadsheet round-trip check.** Open the exported seed file in Google Sheets (or LibreOffice): 21 columns, no row split by the multi-line description, the `;lkj` title intact, the `=`-prefixed cell shown as text, RTL text readable.
   **Done when:** a screenshot of the opened file is attached to the PR.

## Acceptance criteria

**Catalog AC (verbatim):** exported file round-trips in a spreadsheet with hostile seed rows intact.

Verification:
- `pnpm vitest run src/features/submissions/export/csv.test.ts` (quoting table + golden header + injection guard).
- `curl -sD- "$BASE/api/internal/submissions/$EVENT_ID/export.csv?status=pending" -b admin.cookie -o /tmp/pending.csv` → 200, `text/csv`, attachment filename, row count == Pending tab count.
- Manual spreadsheet open of the seeded export (screenshot in the PR).

## Guardrails

- **One query, one truth:** the export reuses `listSubmissions` + `submissionFiltersSchema`. A second SQL path is a review-blocker — the "export doesn't match the screen" bug is the whole reason this module is scoped so tightly.
- **R4 scoping:** eventId from the route, first argument everywhere; never accept a `where` fragment from the client.
- **HTML never reaches the CSV**: descriptions are stripped to plaintext with the shared helper (same one the table cell uses), so `<img onerror>` lands as inert text.
- **CSV injection** is treated as a real trap, not paranoia — public CFP input flows straight into a file organizers open in Excel.
- **Nullables** are empty fields, never `null`/`undefined`/`—` (the `—` dash is a UI affordance, not data).
- **Timezone:** every timestamp formatted through `formatInZone` in the event tz with the zone named in the header; no `date-fns` import outside `time.ts` (CI grep).
- **Do not build** Import Sessions, XLSX, or the files-bundle zip (cut-line #2 / never-build list). If asked, the answer is "CSV export only".
- **Row cap** 5000 with an explicit truncation header — a runaway export must not blow the Worker's CPU/memory budget.

## If blocked

1. If M17's filter schema is still moving: implement `toCsv` + the column set + all tests (pure, zero dependencies) and stub `exportSubmissionsCsv` with fixture rows; the wiring is 20 minutes later.
2. Next in the WS-C lane on Tuesday: polish [M27](./M27-speakers-admin.md) (swap the fixture comms log for M34's real `listLog` once [M37](./M37-comms-admin-ui.md) lands), then help the CP4 hardening pass (seed v3, demo-script accuracy, Playwright `abstracts-decide.spec` stability).
3. Always-available: extend the hostile-row corpus in the seed and re-run the round-trip check; verify the export against the empty second event (header row only, no crash).
