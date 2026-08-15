"use client";

import { useEffect, useState } from "react";
import { TzTime } from "@/shared/ui/app/tz-time";
import { statusBadgeLabel } from "@/shared/ui/status-badge";
import type { SubmissionStatusHistoryEntry } from "../server/queries";

function attribution(entry: SubmissionStatusHistoryEntry): string {
  const actor = entry.actorName ?? entry.actorEmail;
  if (entry.source === "baseline") return "Baseline captured when decision history was enabled";
  if (entry.source === "notification") return actor ? `Finalized by ${actor}` : "Finalized";
  if (entry.source === "speaker") return actor ? `Changed by speaker ${actor}` : "Changed by speaker";
  if (entry.source === "organizer") return actor ? `Changed by ${actor}` : "Changed by an organizer";
  return "Changed by the system";
}

export function SubmissionDecisionHistory({ eventId, submissionId, timezone }: {
  eventId: string;
  submissionId: string;
  timezone: string;
}) {
  const [entries, setEntries] = useState<SubmissionStatusHistoryEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError("");
    fetch(`/api/internal/submissions/${eventId}/${submissionId}/status-history`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          data?: { entries: SubmissionStatusHistoryEntry[] };
          error?: { message?: string };
        } | null;
        if (cancelled) return;
        if (!response.ok || !payload?.data) {
          setError(payload?.error?.message ?? "Could not load decision history");
          return;
        }
        setEntries(payload.data.entries);
      })
      .catch(() => { if (!cancelled) setError("Could not load decision history"); });
    return () => { cancelled = true; };
  }, [eventId, submissionId]);

  return (
    <section className="decision-history">
      <h3>Decision history</h3>
      <p className="muted">Queue moves, final decisions, reversals, and withdrawals remain visible here.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      {!error && entries === null && <p className="muted">Loading decision history…</p>}
      {!error && entries?.length === 0 && <p className="muted">No status changes have been recorded.</p>}
      {!error && entries && entries.length > 0 && (
        <ol className="review-history-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <header>
                <div>
                  <b>{entry.fromStatus ? `${statusBadgeLabel(entry.fromStatus)} → ` : ""}{statusBadgeLabel(entry.toStatus)}</b>
                  <span>{attribution(entry)}{entry.actorEmail && entry.actorName ? ` · ${entry.actorEmail}` : ""}</span>
                </div>
                <TzTime instant={entry.changedAt} tz={timezone} />
              </header>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
