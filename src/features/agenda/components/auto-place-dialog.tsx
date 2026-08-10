"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applyPlacementsInputSchema,
  placementApplyResultDtoSchema,
  placementPreviewDtoSchema,
  type ApplyPlacementInput,
  type EventId,
  type PlacedSuggestionDTO,
  type PlacementApplyResultDTO,
  type PlacementPreviewDTO,
} from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { isAppError } from "@/shared/lib/errors";
import { formatInZone } from "@/shared/lib/time";
import { Button, Modal, StatusBadge } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";

type Step = "loading" | "preview" | "applying" | "done" | "error";

const REASON_COPY: Record<PlacementPreviewDTO["unplaced"][number]["reason"], string> = {
  invalid_duration: "This session has no usable duration — set a format or a duration before placing it.",
  no_legal_slot: "No conflict-free slot was found.",
};

function rejectionSummary(rejections: PlacementPreviewDTO["unplaced"][number]["rejections"]): string | null {
  const parts: string[] = [];
  if (rejections.blackout > 0) parts.push(`${rejections.blackout} blocked by a speaker's declared unavailability`);
  if (rejections.roomOrSpeakerConflict > 0) parts.push(`${rejections.roomOrSpeakerConflict} would double-book a room or speaker`);
  if (rejections.capacity > 0) parts.push(`${rejections.capacity} too small for the expected attendance`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * M54's preview-then-apply flow: fetch a deterministic placement proposal for
 * every unscheduled session, let the organizer accept or drop rows
 * individually, then apply the accepted ones through `moveSession` — never a
 * bespoke write path of its own.
 */
export function AutoPlaceDialog({ eventId, timezone, open, onClose }: {
  eventId: EventId; timezone: string; open: boolean; onClose: () => void;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("loading");
  const [preview, setPreview] = useState<PlacementPreviewDTO | null>(null);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [applyResult, setApplyResult] = useState<PlacementApplyResultDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("loading");
    setPreview(null);
    setApplyResult(null);
    setError(null);
    (async () => {
      try {
        const result = await api(`agenda/placements?eventId=${eventId}`, placementPreviewDtoSchema);
        setPreview(result);
        setAccepted(new Set(result.placed.map((row) => String(row.sessionId))));
        setStep("preview");
      } catch (caught) {
        setError(isAppError(caught) ? caught.message : "Could not build a placement preview");
        setStep("error");
      }
    })();
  }, [open, eventId]);

  const acceptedRows = useMemo(
    () => (preview?.placed ?? []).filter((row) => accepted.has(String(row.sessionId))),
    [preview, accepted],
  );

  function toggle(sessionId: string) {
    setAccepted((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  async function apply() {
    if (acceptedRows.length === 0) return;
    setStep("applying");
    setError(null);
    try {
      const body: { accepted: ApplyPlacementInput[] } = applyPlacementsInputSchema.parse({
        accepted: acceptedRows.map((row): ApplyPlacementInput => ({
          sessionId: row.sessionId, version: row.version, startsAt: row.startsAt, endsAt: row.endsAt, roomId: row.roomId,
        })),
      });
      const result = await api(`agenda/placements/apply?eventId=${eventId}`, placementApplyResultDtoSchema, { method: "POST", body });
      setApplyResult(result);
      setStep("done");
      const appliedCount = result.outcomes.filter((outcome) => outcome.outcome === "applied").length;
      toast(`${appliedCount} session${appliedCount === 1 ? "" : "s"} placed`);
    } catch (caught) {
      setError(isAppError(caught) ? caught.message : "Could not apply those placements");
      setStep("preview");
    }
  }

  function whenLabel(row: Pick<PlacedSuggestionDTO, "startsAt" | "endsAt">): string {
    return `${formatInZone(row.startsAt, timezone, "date")} · ${formatInZone(row.startsAt, timezone, "time")}–${formatInZone(row.endsAt, timezone, "time")}`;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Auto-place unscheduled sessions"
      description="A deterministic, conflict-safe proposal — nothing is written until you apply it."
      wide
      footer={
        step === "preview" ? (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button disabled={acceptedRows.length === 0} onClick={() => void apply()}>
              {`Apply ${acceptedRows.length} placement${acceptedRows.length === 1 ? "" : "s"}`}
            </Button>
          </>
        ) : step === "done" ? (
          <Button onClick={onClose}>Done</Button>
        ) : step === "error" ? (
          <Button variant="secondary" onClick={onClose}>Close</Button>
        ) : undefined
      }
    >
      {(step === "loading" || step === "applying") && <p className="long-copy">{step === "loading" ? "Finding conflict-safe slots…" : "Applying accepted placements…"}</p>}

      {error && <p className="field-error" role="alert">{error}</p>}

      {step === "preview" && preview && (
        <div className="form-stack">
          <p className="long-copy">
            {preview.placed.length} session{preview.placed.length === 1 ? "" : "s"} can be placed · {preview.unplaced.length} could not
          </p>

          {preview.placed.length === 0 && preview.unplaced.length === 0 && <p className="dash">Every session is already on the schedule.</p>}

          {preview.placed.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th /><th>Session</th><th>Proposed day &amp; time</th><th>Room</th></tr></thead>
                <tbody>
                  {preview.placed.map((row) => (
                    <tr key={String(row.sessionId)}>
                      <td>
                        <input
                          type="checkbox"
                          checked={accepted.has(String(row.sessionId))}
                          onChange={() => toggle(String(row.sessionId))}
                          aria-label={`Accept placement for ${row.title}`}
                        />
                      </td>
                      <td>{row.title}</td>
                      <td>{whenLabel(row)}</td>
                      <td>{row.roomName ?? "No room"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.unplaced.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Session</th><th>Status</th><th>Why</th></tr></thead>
                <tbody>
                  {preview.unplaced.map((row) => {
                    const detail = rejectionSummary(row.rejections);
                    return (
                      <tr key={String(row.sessionId)}>
                        <td>{row.title}</td>
                        <td><StatusBadge value="unplaced" /></td>
                        <td>{REASON_COPY[row.reason]}{detail ? ` (${detail})` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {step === "done" && applyResult && (
        <div className="form-stack">
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Session</th><th>Result</th><th>Detail</th></tr></thead>
              <tbody>
                {applyResult.outcomes.map((outcome) => (
                  <tr key={String(outcome.sessionId)}>
                    <td>{preview?.placed.find((row) => row.sessionId === outcome.sessionId)?.title ?? String(outcome.sessionId)}</td>
                    <td><StatusBadge value={outcome.outcome === "stale" ? "changed" : outcome.outcome} /></td>
                    <td>{outcome.outcome === "applied" ? "Placed on the schedule" : outcome.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
