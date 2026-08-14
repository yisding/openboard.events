"use client";

import { useEffect, useMemo, useState } from "react";
import { MAX_BULK_AGENDA_PROMOTIONS, type AcceptedForSchedulingRow, type BulkAgendaPromotionResult, type EventId, type SubmissionId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { Button } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { useSessionMutations } from "../hooks/use-session-mutations";

type PromotionFailure = { submissionId: string; title: string; message: string };
type PromotionFeedback = { kind: "rejected" | "unconfirmed"; failures: PromotionFailure[] };

export function bulkPromotionSummary(result: Pick<BulkAgendaPromotionResult, "created" | "alreadyExisted" | "rejected">): string {
  return [
    result.created > 0 ? `${result.created} created` : null,
    result.alreadyExisted > 0 ? `${result.alreadyExisted} already on the agenda` : null,
    result.rejected > 0 ? `${result.rejected} rejected` : null,
  ].filter(Boolean).join(" · ") || "Nothing changed";
}

export function rejectedPromotionIds(result: BulkAgendaPromotionResult): string[] {
  return result.results.flatMap((row) => row.outcome === "rejected" ? [String(row.submissionId)] : []);
}

/** Accepted abstracts are a separate intake queue, not a second unscheduled-session tray. */
export function ReadyToPromoteTray({ eventId, accepted }: {
  eventId: EventId;
  accepted: AcceptedForSchedulingRow[];
}) {
  const { toast } = useToast();
  const { promoteBatch } = useSessionMutations(eventId);
  const promotable = useMemo(() => accepted.filter((row) => !row.alreadyPromoted), [accepted]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [promotionFeedback, setPromotionFeedback] = useState<PromotionFeedback | null>(null);
  const selectedRows = useMemo(
    () => promotable.filter((row) => selected.has(String(row.submissionId))),
    [promotable, selected],
  );
  const allSelected = promotable.length > 0 && selectedRows.length === Math.min(promotable.length, MAX_BULK_AGENDA_PROMOTIONS);

  // A successful or unconfirmed batch refreshes the accepted server prop once.
  // Drop rows that the refreshed truth says are now sessions, while preserving
  // every still-promotable rejection for a corrected retry.
  useEffect(() => {
    const available = new Set(promotable.map((row) => String(row.submissionId)));
    setSelected((current) => {
      const next = new Set([...current].filter((id) => available.has(id)));
      return next.size === current.size ? current : next;
    });
    setPromotionFeedback((current) => {
      if (!current) return null;
      if (current.kind === "rejected") return current;
      const failures = current.failures.filter((row) => available.has(row.submissionId));
      return failures.length === current.failures.length ? current : failures.length > 0 ? { ...current, failures } : null;
    });
  }, [promotable]);

  const toggle = (submissionId: SubmissionId) => {
    setSelected((current) => {
      const next = new Set(current);
      const key = String(submissionId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setPromotionFeedback(null);
  };

  const addSelected = async () => {
    if (selectedRows.length === 0) return;
    const attempted = selectedRows;
    setPromotionFeedback(null);
    try {
      const result = await promoteBatch.mutateAsync(attempted.map((row) => row.submissionId));
      const rejected = result.results.flatMap((row) => {
        if (row.outcome !== "rejected") return [];
        return [{
          submissionId: String(row.submissionId),
          title: promotable.find((candidate) => candidate.submissionId === row.submissionId)?.title ?? "Abstract",
          message: row.message,
        }];
      });
      setSelected(new Set(rejectedPromotionIds(result)));
      setPromotionFeedback(rejected.length > 0 ? { kind: "rejected", failures: rejected } : null);
      toast(
        `${bulkPromotionSummary(result)}${rejected.length > 0 ? ". Rejected rows that remain eligible stay selected." : ""}`,
        rejected.length > 0 ? { kind: "error" } : undefined,
      );
    } catch (caught) {
      const message = isAppError(caught) ? caught.message : "Could not confirm that batch";
      setPromotionFeedback({
        kind: "unconfirmed",
        failures: attempted.map((row) => ({
          submissionId: String(row.submissionId),
          title: row.title,
          message: "Could not confirm whether this abstract was added",
        })),
      });
      toast(`${attempted.length} could not be confirmed. ${message}. The list was refreshed; selected rows are safe to retry.`, { kind: "error" });
    }
  };

  return (
    <aside className="unscheduled-tray promotion-tray" aria-label="Accepted abstracts ready to promote">
      <div className="accepted-tray">
        <div className="accepted-tray-heading">
          <span>READY TO PROMOTE</span>
          <span>{promotable.length}</span>
        </div>
        {promotable.length === 0 && <p className="dash">Every accepted abstract is on the agenda.</p>}
        {promotable.length > 0 && (
          <>
            <div className="accepted-tray-actions">
              <Button
                size="sm"
                variant="secondary"
                aria-pressed={allSelected}
                disabled={promoteBatch.isPending}
                onClick={() => setSelected(allSelected
                  ? new Set()
                  : new Set(promotable.slice(0, MAX_BULK_AGENDA_PROMOTIONS).map((row) => String(row.submissionId))))}
              >
                {allSelected ? "Clear all" : promotable.length > MAX_BULK_AGENDA_PROMOTIONS ? `Select first ${MAX_BULK_AGENDA_PROMOTIONS}` : "Select all"}
              </Button>
              <Button size="sm" disabled={selectedRows.length === 0 || promoteBatch.isPending} onClick={() => { void addSelected(); }}>
                {promoteBatch.isPending ? "Adding…" : `Add ${selectedRows.length}`}
              </Button>
            </div>
            {promotionFeedback && (
              <div className="accepted-tray-feedback" role="alert">
                <b>{promotionFeedback.kind === "rejected" ? "Some abstracts were rejected" : "Some results could not be confirmed"}</b>
                <ul>
                  {promotionFeedback.failures.map((failure) => <li key={failure.submissionId}>{failure.title}: {failure.message}</li>)}
                </ul>
              </div>
            )}
            <div className="accepted-tray-list" role="group" aria-label="Accepted abstracts ready to add">
              {promotable.map((row) => (
                <label className="accepted-tray-row" key={String(row.submissionId)}>
                  <input
                    type="checkbox"
                    checked={selected.has(String(row.submissionId))}
                    disabled={promoteBatch.isPending || (!selected.has(String(row.submissionId)) && selected.size >= MAX_BULK_AGENDA_PROMOTIONS)}
                    onChange={() => toggle(row.submissionId)}
                    aria-label={`Select abstract ${row.code}: ${row.title}`}
                  />
                  <span><small>#{row.code}</small><b>{row.title}</b></span>
                </label>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
