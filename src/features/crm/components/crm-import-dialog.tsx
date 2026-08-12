"use client";

import { Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseCsv } from "@/features/portal/server/speaker-csv";
import {
  CRM_CSV_FIELDS,
  importCrmContactsCsvResultSchema,
  type CrmCsvField,
  type CrmCsvColumnMapping,
  type ImportCrmContactsCsvResult,
  type OrganizationId,
} from "@/shared/contracts";
import { Button, Field, Modal, Select, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";

const FIELD_LABELS: Record<CrmCsvField, string> = {
  firstName: "First name",
  lastName: "Last name",
  company: "Company",
  jobTitle: "Title",
  linkedinUrl: "LinkedIn URL",
  twitterUrl: "Twitter/X URL",
  websiteUrl: "Website URL",
};

const NONE = "__none__";

/** Same RFC-4180-ish quoting as M51's speaker import error export
 * (`speaker-import-dialog.tsx`) — deliberately not shared, same reasoning
 * that file's own comment gives: a three-column error report is not worth
 * pulling in a whole export module for. */
function csvField(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function downloadErrorsCsv(rows: ImportCrmContactsCsvResult["rows"]) {
  const bad = rows.filter((row) => row.status === "error");
  const lines = ["Row,Email,Error", ...bad.map((row) => [String(row.rowNumber), row.email ?? "", row.error ?? ""].map(csvField).join(","))];
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "crm-import-errors.csv";
  link.click();
  URL.revokeObjectURL(url);
}

type Step = "upload" | "map" | "preview" | "done";

const STATUS_LABEL: Record<ImportCrmContactsCsvResult["rows"][number]["status"], string> = {
  created: "new",
  matched_existing: "matched",
  duplicate_in_file: "duplicate",
  error: "error",
};

/**
 * M55 — CSV import (work order scope): upload → map columns → preview with
 * row-level errors and organization-aware duplicate detection → commit.
 * Structurally identical to M51's `SpeakerImportDialog` (same `parseCsv`,
 * same upload/map/preview/done steps) — deliberately, since the two flows
 * differ only in the destination and field list, not in the interaction.
 */
export function CrmImportDialog({ organizationId, open, onClose }: { organizationId: OrganizationId; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [emailColumn, setEmailColumn] = useState<number | null>(null);
  const [fieldColumns, setFieldColumns] = useState<Partial<Record<CrmCsvField, number>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportCrmContactsCsvResult | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCrmContactsCsvResult | null>(null);

  const mapping = useMemo<CrmCsvColumnMapping | null>(() => (
    emailColumn === null ? null : { email: emailColumn, fields: fieldColumns }
  ), [emailColumn, fieldColumns]);

  function reset() {
    setStep("upload"); setCsvText(""); setHeaders([]); setEmailColumn(null); setFieldColumns({});
    setError(null); setPreview(null); setCommitResult(null);
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
      const guessedEmail = headerRow.findIndex((cell) => cell.trim().toLowerCase() === "email");
      setEmailColumn(guessedEmail >= 0 ? guessedEmail : null);
      setStep("map");
    };
    reader.onerror = () => setError("Could not read that file");
    reader.readAsText(file);
  }

  async function run(mode: "preview" | "commit") {
    if (!mapping) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api(`organizations/${organizationId}/crm/import`, importCrmContactsCsvResultSchema, {
        method: "POST",
        body: { csvText, mapping, mode },
      });
      if (mode === "preview") {
        setPreview(result);
        setStep("preview");
      } else {
        setCommitResult(result);
        setStep("done");
        toast(`${result.created} created · ${result.matchedExisting} matched`);
        router.refresh();
      }
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : mode === "preview" ? "Could not read that file" : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? commitResult;
  const readyCount = shown ? shown.created + shown.matchedExisting : 0;

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Import contacts from CSV"
      description="Upload a spreadsheet export, map its columns, review what will change, then commit. A row is matched to an existing organization contact by email; nothing already filled in is ever overwritten."
      wide
      footer={
        step === "map" ? (
          <>
            <Button variant="secondary" onClick={() => setStep("upload")}>Back</Button>
            <Button disabled={emailColumn === null || busy} onClick={() => void run("preview")}>{busy ? "Reading…" : "Preview"}</Button>
          </>
        ) : step === "preview" ? (
          <>
            <Button variant="secondary" onClick={() => setStep("map")}>Back</Button>
            {shown && shown.errors > 0 && <Button variant="secondary" onClick={() => downloadErrorsCsv(shown.rows)}>Download errors ({shown.errors})</Button>}
            <Button disabled={!shown || readyCount === 0 || busy} onClick={() => void run("commit")}>
              {busy ? "Importing…" : `Import ${readyCount} contact${readyCount === 1 ? "" : "s"}`}
            </Button>
          </>
        ) : step === "done" ? (
          <>
            {commitResult && commitResult.errors > 0 && <Button variant="secondary" onClick={() => downloadErrorsCsv(commitResult.rows)}>Download errors ({commitResult.errors})</Button>}
            <Button onClick={() => { reset(); onClose(); }}>Done</Button>
          </>
        ) : undefined
      }
    >
      {step === "upload" && (
        <div className="form-stack">
          <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); }} />
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      )}

      {step === "map" && (
        <div className="form-stack">
          <Field label="Email column" required>
            <Select value={emailColumn ?? ""} onChange={(event) => setEmailColumn(event.target.value === "" ? null : Number(event.target.value))}>
              <option value="">Select a column…</option>
              {headers.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}
            </Select>
          </Field>
          <div className="form-grid">
            {CRM_CSV_FIELDS.map((field) => (
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
          <p className="long-copy">{shown.created} new · {shown.matchedExisting} matched to an existing contact · {shown.errors} to skip</p>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Row</th><th>Email</th><th>Status</th><th>Detail</th></tr></thead>
              <tbody>
                {shown.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>{row.email ?? "—"}</td>
                    <td><StatusBadge value={STATUS_LABEL[row.status]} /></td>
                    <td>{row.error ?? "—"}</td>
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
            <div><Upload size={18} /><p><b>{commitResult.created} created · {commitResult.matchedExisting} matched</b><small>{commitResult.errors} row{commitResult.errors === 1 ? "" : "s"} skipped</small></p></div>
          </div>
        </div>
      )}
    </Modal>
  );
}
