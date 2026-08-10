"use client";

import { ArrowRight, GripVertical } from "lucide-react";
import { useMemo } from "react";
import type { SubmissionId } from "@/shared/contracts";
import { isAppError } from "@/shared/lib/errors";
import { useToast } from "@/shared/ui/toast";
import { useSessionMutations } from "../hooks/use-session-mutations";
import type { AgendaViewProps } from "../index.client";
import { nameLookup, unscheduled } from "../store";

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
export function UnscheduledTray({ eventId, sessions, accepted, rooms, tracks, formats, speakers, onEdit }: AgendaViewProps) {
  const { toast } = useToast();
  const { promote } = useSessionMutations(eventId);
  const lookup = useMemo(() => nameLookup({ rooms, tracks, formats, speakers }), [rooms, tracks, formats, speakers]);
  const drafts = useMemo(() => unscheduled(sessions), [sessions]);
  const promotable = useMemo(() => accepted.filter((row) => !row.alreadyPromoted), [accepted]);

  const add = async (submissionId: SubmissionId, title: string) => {
    try {
      await promote.mutateAsync(submissionId);
      toast(`“${title}” added to the agenda`);
    } catch (caught) {
      toast(isAppError(caught) ? caught.message : "Could not add that abstract");
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
        <span>READY TO PROMOTE</span>
        {promotable.length === 0 && <p className="dash">Every accepted abstract is on the agenda.</p>}
        {promotable.map((row) => (
          <div key={String(row.submissionId)}>
            <b>{row.title}</b>
            <button
              type="button"
              aria-label={`Add ${row.title} to the agenda`}
              disabled={promote.isPending}
              onClick={() => { void add(row.submissionId, row.title); }}
            >
              ＋
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
