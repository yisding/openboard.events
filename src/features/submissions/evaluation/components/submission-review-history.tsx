"use client";

import { useEffect, useState } from "react";
import { SkeletonText } from "@/shared/ui/app/skeleton";
import { TzTime } from "@/shared/ui/app/tz-time";
import type { ReviewHistoryEntry } from "../types";

/** The proposal-level audit trail organizers use to explain changed verdicts. */
export function SubmissionReviewHistory({
  eventId,
  submissionId,
  timezone,
}: {
  eventId: string;
  submissionId: string;
  timezone: string;
}) {
  const [entries, setEntries] = useState<ReviewHistoryEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError("");
    fetch(`/api/internal/evaluation/${eventId}/submissions/${submissionId}/reviews`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          data?: { entries: ReviewHistoryEntry[] };
          error?: { message?: string };
        } | null;
        if (cancelled) return;
        if (!response.ok || !payload?.data) {
          setError(payload?.error?.message ?? "Could not load review history");
          return;
        }
        setEntries(payload.data.entries);
      })
      .catch(() => { if (!cancelled) setError("Could not load review history"); });
    return () => { cancelled = true; };
  }, [eventId, submissionId]);

  return (
    <section className="review-history">
      <h3>Review history</h3>
      <p className="muted">Every meaningful score save is retained here, including prior values after an edit.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      {!error && entries === null && <SkeletonText lines={2} label="Loading review history…" />}
      {!error && entries?.length === 0 && <p className="muted">No scores have been saved for this submission.</p>}
      {!error && entries && entries.length > 0 && (
        <ol className="review-history-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <header>
                <div>
                  <b>{entry.planName} · {entry.isAi ? "AI-generated review" : entry.reviewerName}</b>
                  <span>{entry.isAi ? `Generated for ${entry.reviewerName} (${entry.reviewerEmail})` : entry.reviewerEmail} · Revision {entry.revision} · <TzTime instant={entry.recordedAt} tz={timezone} /></span>
                </div>
                <strong>{entry.overallScore === null ? (entry.complete ? "Complete" : "In progress") : entry.overallScore}</strong>
              </header>
              {entry.answers.length > 0 && (
                <dl>
                  {entry.answers.map((answer) => (
                    <div key={answer.criterionId}>
                      <dt>{answer.label}</dt>
                      <dd>{answer.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {entry.comment && <p>{entry.comment}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
