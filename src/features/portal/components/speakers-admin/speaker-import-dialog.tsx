"use client";

import { Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { applyCsvCellEdits, parseCsv } from "@/features/portal/index.csv";
import { SPEAKER_CSV_FIELDS, type ImportSpeakersCsvResult, type SpeakerCsvColumnMapping, type SpeakerCsvField } from "@/shared/contracts";
import { Button, Field, Modal, Select, StatusBadge } from "@/shared/ui/ui-kit";
import { LocalFilePicker } from "@/shared/ui/app/file-upload";
import { useToast } from "@/shared/ui/toast";

const FIELD_LABELS: Record<SpeakerCsvField, string> = {
  firstName: "First name",
  lastName: "Last name",
  jobTitle: "Title",
  company: "Company",
  linkedinUrl: "LinkedIn URL",
  twitterUrl: "Twitter/X URL",
  websiteUrl: "Website URL",
};

const NONE = "__none__";

/** Quotes a CSV field per RFC 4180 — deliberately small and local rather than
 * pulled in from M20's export module (a different feature's internal path);
 * the error report here is three plain-text columns, not a full export
 * catalog. */
function csvField(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function downloadErrorsCsv(rows: ImportSpeakersCsvResult["rows"]) {
  const bad = rows.filter((row) => row.status !== "ok");
  const lines = ["Row,Email,Error", ...bad.map((row) => [String(row.rowNumber), row.email ?? "", row.error ?? ""].map(csvField).join(","))];
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "speaker-import-errors.csv";
  link.click();
  URL.revokeObjectURL(url);
}

type Step = "upload" | "map" | "preview" | "done";

/**
 * M51 — CSV import (work order step 3): upload → map columns → preview with
 * row-level errors and every proposed field change → commit. Preview and
 * commit are the same server call (`importSpeakersCsv`) with `mode` swapped,
 * so what the organizer approved is exactly what gets written.
 */
export function SpeakerImportDialog({ eventId, open, onClose }: { eventId: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [emailColumn, setEmailColumn] = useState<number | null>(null);
  const [fieldColumns, setFieldColumns] = useState<Partial<Record<SpeakerCsvField, number>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportSpeakersCsvResult | null>(null);
  const [commitResult, setCommitResult] = useState<ImportSpeakersCsvResult | null>(null);
  // Rejected rows, corrected in place: `{ [rowNumber]: email }`.
  const [fixes, setFixes] = useState<Record<number, string>>({});

  const mapping = useMemo<SpeakerCsvColumnMapping | null>(() => (
    emailColumn === null ? null : { email: emailColumn, fields: fieldColumns }
  ), [emailColumn, fieldColumns]);

  function reset() {
    setStep("upload"); setCsvText(""); setHeaders([]); setEmailColumn(null); setFieldColumns({});
    setError(null); setPreview(null); setCommitResult(null); setFixes({});
    if (fileInput.current) fileInput.current.value = "";
  }

  function onFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const rows = parseCsv(text);
      const [headerRow] = rows;
      if (!headerRow || headerRow.length === 0) { setError("That file has no header row"); return; }
      setCsvText(text);
      setHeaders(headerRow);
      // A correction is keyed by row number against the file it was typed for;
      // a new upload reuses those row numbers, so stale fixes must not survive
      // it (Back → Back → pick a different file would otherwise re-apply them).
      setFixes({});
      // A column named "email" (any case) is the overwhelmingly common case;
      // preselect it so most files need zero mapping clicks.
      const guessedEmail = headerRow.findIndex((cell) => cell.trim().toLowerCase() === "email");
      setEmailColumn(guessedEmail >= 0 ? guessedEmail : null);
      setStep("map");
    };
    reader.onerror = () => setError("Could not read that file");
    reader.readAsText(file);
  }

  async function runPreview(text: string = csvText): Promise<boolean> {
    if (!mapping) return false;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/internal/speakers/${eventId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText: text, mapping, mode: "preview" }),
      });
      const json = await response.json() as { data?: ImportSpeakersCsvResult; error?: { message?: string } };
      if (!response.ok || !json.data) throw new Error(json.error?.message ?? "Could not read that file");
      setPreview(json.data);
      setStep("preview");
      return true;
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Could not read that file");
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Every rejection this import can produce is about one cell: a missing
   * email, an unparseable one, or an address the file repeats. So a rejected
   * row is fixable where the organizer is looking at it — the correction is
   * written into the uploaded CSV and re-previewed through the same server
   * validation as the original upload, rather than sending them back to the
   * spreadsheet to re-export the whole file. (Rejected rows never blocked the
   * batch: the valid ones import either way, and the skipped ones are listed
   * here with their reason and downloadable as a CSV.)
   */
  async function recheckFixedRows() {
    if (!mapping) return;
    const corrections: Record<number, string> = {};
    for (const [rowNumber, value] of Object.entries(fixes)) {
      if (value.trim() !== "") corrections[Number(rowNumber)] = value.trim();
    }
    if (Object.keys(corrections).length === 0) return;
    const corrected = applyCsvCellEdits(csvText, mapping.email, corrections);
    // Only adopt the corrected file once the server has actually previewed it.
    // If the request fails the old preview stands and the typed fixes remain,
    // so the footer can't fall back to importing unpreviewed corrections.
    if (await runPreview(corrected)) {
      setCsvText(corrected);
      setFixes({});
    }
  }

  async function runCommit() {
    if (!mapping) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/internal/speakers/${eventId}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText, mapping, mode: "commit" }),
      });
      const json = await response.json() as { data?: ImportSpeakersCsvResult; error?: { message?: string } };
      if (!response.ok || !json.data) throw new Error(json.error?.message ?? "Import failed");
      setCommitResult(json.data);
      setStep("done");
      toast(`${json.data.committed} speaker${json.data.committed === 1 ? "" : "s"} imported`);
      router.refresh();
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? commitResult;
  const fixedRowCount = Object.values(fixes).filter((value) => value.trim() !== "").length;

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Import speakers from CSV"
      description="Upload a spreadsheet export, map its columns, review what will change, then commit."
      wide
      footer={
        step === "map" ? (
          <>
            <Button variant="secondary" onClick={() => setStep("upload")}>Back</Button>
            <Button disabled={emailColumn === null || busy} onClick={() => void runPreview()}>{busy ? "Reading…" : "Preview"}</Button>
          </>
        ) : step === "preview" ? (
          <>
            <Button variant="secondary" onClick={() => setStep("map")}>Back</Button>
            {shown && shown.invalid > 0 && <Button variant="secondary" onClick={() => downloadErrorsCsv(shown.rows)}>Download errors ({shown.invalid})</Button>}
            {fixedRowCount > 0 ? (
              // A typed fix has to be validated before it can be imported, so it
              // replaces the import button rather than being silently dropped by it.
              <Button disabled={busy} onClick={() => void recheckFixedRows()}>
                {busy ? "Re-checking…" : `Re-check ${fixedRowCount} row${fixedRowCount === 1 ? "" : "s"}`}
              </Button>
            ) : (
              <Button disabled={!shown || shown.valid === 0 || busy} onClick={() => void runCommit()}>
                {busy ? "Importing…" : `Import ${shown?.valid ?? 0} speaker${shown?.valid === 1 ? "" : "s"}`}
              </Button>
            )}
          </>
        ) : step === "done" ? (
          <>
            {commitResult && commitResult.invalid > 0 && <Button variant="secondary" onClick={() => downloadErrorsCsv(commitResult.rows)}>Download errors ({commitResult.invalid})</Button>}
            <Button onClick={() => { reset(); onClose(); }}>Done</Button>
          </>
        ) : undefined
      }
    >
      {step === "upload" && (
        <div className="form-stack">
          <p className="long-copy">A row is matched to an existing speaker by normalized email; a new email creates a speaker. No field already filled in is ever overwritten — the preview names every change before anything is written.</p>
          <Field label="CSV file" required group>
            <LocalFilePicker accept=".csv,text/csv" label="Choose a CSV file" hint="One header row, comma separated" inputRef={fileInput} onPick={onFile} />
          </Field>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      )}

      {step === "map" && (
        <div className="form-stack">
          <Field label="Email column" required>
            <Select value={emailColumn ?? ""} onChange={(event) => { setFixes({}); setEmailColumn(event.target.value === "" ? null : Number(event.target.value)); }}>
              <option value="">Select a column…</option>
              {headers.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}
            </Select>
          </Field>
          <div className="form-grid">
            {SPEAKER_CSV_FIELDS.map((field) => (
              <Field key={field} label={FIELD_LABELS[field]}>
                <Select
                  value={fieldColumns[field] ?? NONE}
                  onChange={(event) => setFieldColumns((current) => {
                    const next = { ...current };
                    delete next[field];
                    return event.target.value === NONE ? next : { ...next, [field]: Number(event.target.value) };
                  })}
                >
                  <option value={NONE}>— not in this file —</option>
                  {headers.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      )}

      {step === "preview" && shown && (
        <div className="form-stack">
          <p className="long-copy">
            {shown.valid} row{shown.valid === 1 ? "" : "s"} ready to import · {shown.invalid} to skip
            {shown.invalid > 0 && " — a skipped row never holds up the rest, and you can correct its email here instead of re-exporting the file."}
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Row</th><th>Email</th><th>Status</th><th>Changes</th></tr></thead>
              <tbody>
                {shown.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>
                      {row.status === "ok" ? row.email ?? "—" : (
                        <input
                          type="email"
                          aria-label={`Corrected email for row ${row.rowNumber}`}
                          placeholder={row.email ?? "name@example.com"}
                          value={fixes[row.rowNumber] ?? ""}
                          onChange={(event) => setFixes((current) => ({ ...current, [row.rowNumber]: event.target.value }))}
                        />
                      )}
                    </td>
                    <td><StatusBadge value={row.status === "ok" ? "ready" : row.status === "duplicate_in_file" ? "duplicate" : "error"} /></td>
                    <td>{row.error ?? (row.changedFields.length > 0 ? row.changedFields.map((field) => FIELD_LABELS[field as SpeakerCsvField] ?? field).join(", ") : "No changes")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      )}

      {step === "done" && commitResult && (
        <div className="form-stack">
          <div className="notify-bar">
            <div><Upload size={18} /><p><b>{commitResult.committed} speaker{commitResult.committed === 1 ? "" : "s"} imported</b><small>{commitResult.invalid} row{commitResult.invalid === 1 ? "" : "s"} skipped</small></p></div>
          </div>
        </div>
      )}
    </Modal>
  );
}
