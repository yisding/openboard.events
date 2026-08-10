"use client";

import { useEffect, useState } from "react";
import type { SubmissionDetailDTO } from "@/shared/contracts";
import { formatCode } from "@/features/submissions/index.client";
import { SubmissionAnswers } from "./submission-answers";
import { RichTextView } from "@/shared/ui/app/rich-text-view";
import { TzTime } from "@/shared/ui/app/tz-time";
import { Dash } from "@/shared/ui/app/dash";
import { Drawer, StatusBadge } from "@/shared/ui/ui-kit";

/**
 * The submission a reviewer opens. Answers render through the *pinned* snapshot,
 * so a question renamed after submission still reads the way the speaker
 * answered it — labels are read from the version they saw, not from the form as
 * it looks today.
 */
export function SubmissionDrawer({
  eventId,
  submissionId,
  timezone,
  onClose,
}: {
  eventId: string;
  submissionId: string;
  timezone: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<SubmissionDetailDTO | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError("");
    fetch(`/api/internal/submissions/${eventId}/${submissionId}`)
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { data?: SubmissionDetailDTO; error?: { message?: string } } | null;
        if (cancelled) return;
        if (!response.ok || !payload?.data) setError(payload?.error?.message ?? "Could not load this submission");
        else setDetail(payload.data);
      })
      .catch(() => { if (!cancelled) setError("Could not load this submission"); });
    // A reviewer clicking down a list opens several in a row; a late response
    // for one they have already moved past must not replace what they are reading.
    return () => { cancelled = true; };
  }, [eventId, submissionId]);

  return (
    <Drawer open onClose={onClose} title={detail ? formatCode(detail.code) : "Submission"}>
      {error && <p className="portal-note" role="alert">{error}</p>}
      {!detail && !error && <p className="portal-note">Loading…</p>}
      {detail && (
        <div className="submission-drawer">
          <header className="drawer-hero">
            <StatusBadge value={detail.status} />
            <h2>{detail.title}</h2>
            <p>
              {detail.submittedAt
                ? <>Submitted <TzTime instant={detail.submittedAt} tz={timezone} style="long" /></>
                : <>Not submitted</>}
            </p>
          </header>

          <div className="drawer-content">
            <section>
              <h3>Speakers</h3>
              <ul className="portal-participants">
                {detail.participants.map((participant) => (
                  <li key={participant.id}>
                    <b>{participant.name}</b>
                    <span>{participant.email}</span>
                    {participant.isPrimary && <em>Primary contact</em>}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3>Description</h3>
              {detail.descriptionHtml ? <RichTextView html={detail.descriptionHtml} /> : <Dash />}
            </section>

            <section>
              <h3>Answers</h3>
              <SubmissionAnswers data={detail.answerPanel} />
            </section>
          </div>
        </div>
      )}
    </Drawer>
  );
}
