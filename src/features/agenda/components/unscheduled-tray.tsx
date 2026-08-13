"use client";

import { ArrowRight, GripVertical, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MAX_BULK_AGENDA_PROMOTIONS, type BulkAgendaPromotionResult, type SubmissionId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { Button } from "@/shared/ui/ui-kit";
import { useToast } from "@/shared/ui/toast";
import { useSessionMutations } from "../hooks/use-session-mutations";
import { agendaKeys } from "../hooks/keys";
import type { AgendaViewProps } from "../index.client";
import { nameLookup, unscheduled } from "../store";
import { AutoPlaceDialog } from "./auto-place-dialog";

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

/**
 * The two ways a session that is not on the grid can reach it.
 *
 * Top half: sessions with NULL times. M30 makes these cards a drag source; here
 * they are static cards with an Edit affordance, which is enough to place one
 * through the dialog before drag-and-drop exists.
 *
 * Bottom half: accepted abstracts with no session yet. The filter is
 * `!row.alreadyPromoted` — the field `AcceptedForSchedulingRow` actually carries
 * — so a re-promote never offers a second copy of a talk already on the agenda.
 */
export function UnscheduledTray({ eventId, event, sessions, accepted, rooms, tracks, formats, speakers, onEdit }: AgendaViewProps) {
  const { toast } = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { promoteBatch } = useSessionMutations(eventId);
  const lookup = useMemo(() => nameLookup({ rooms, tracks, formats, speakers }), [rooms, tracks, formats, speakers]);
  const drafts = useMemo(() => unscheduled(sessions), [sessions]);
  const promotable = useMemo(() => accepted.filter((row) => !row.alreadyPromoted), [accepted]);
  const [autoPlaceOpen, setAutoPlaceOpen] = useState(false);
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
    <aside className="unscheduled-tray">
      <header>
        <div>
          <h2>Unscheduled</h2>
          <span>{drafts.length}</span>
        </div>
        <p>Open a session to place it on the grid.</p>
        {/* M54 — one action previews conflict-safe slots for every unscheduled
            session; nothing is written until the organizer applies it. */}
        <Button variant="secondary" size="sm" disabled={drafts.length === 0} onClick={() => setAutoPlaceOpen(true)}>
          <Wand2 size={14} aria-hidden /> Auto-place
        </Button>
      </header>

      {drafts.length === 0 && <p className="dash">Everything is scheduled.</p>}
      {drafts.map((session) => {
        const track = lookup.track(session.trackId);
        return (
          <button key={String(session.id)} type="button" onClick={() => onEdit?.(String(session.id))}>
            <GripVertical size={15} aria-hidden />
            <div>
              <b>{session.title}</b>
              <span>{track?.name ?? "No track"}{lookup.speakers(session.speakerIds).length > 0 ? ` · ${lookup.speakers(session.speakerIds).join(", ")}` : ""}</span>
            </div>
            <ArrowRight size={14} aria-hidden />
          </button>
        );
      })}

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

      <AutoPlaceDialog
        eventId={eventId}
        timezone={event.timezone}
        open={autoPlaceOpen}
        onClose={() => {
          setAutoPlaceOpen(false);
          // Applied rows moved sessions server-side; the grid's cache and the
          // page's server-rendered conflicts both need a fresh read, exactly
          // like every other agenda write settles (`use-session-mutations`).
          void queryClient.invalidateQueries({ queryKey: agendaKeys.allSessions(eventId) });
          router.refresh();
        }}
      />
    </aside>
  );
}
