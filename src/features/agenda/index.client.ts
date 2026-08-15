import type {
  AcceptedForSchedulingRow,
  ConflictDTO,
  EventDTO,
  EventId,
  RoomDTO,
  ScheduledSessionDTO,
  SessionFormatDTO,
  TrackDTO,
} from "@/shared/contracts";
import type { SpeakerOption } from "./server/queries";

/**
 * What every agenda view receives — the same object, whichever tab is showing.
 *
 * The set is deliberately whole rather than pre-filtered: `sessions` carries the
 * unscheduled rows too, because the tray and the List view need them and a view
 * that wants only the placed ones filters in one line. Pre-filtering here would
 * mean M30 and M31 each asking this module for a different prop.
 *
 * `conflicts` is derived once from the live session cache so the Conflicts
 * tab's badge, the grid's red borders and the List view's warning chips cannot
 * disagree after a mutation.
 */
export type AgendaViewProps = {
  eventId: EventId;
  event: Pick<EventDTO, "timezone" | "startsAt" | "endsAt">;
  sessions: ScheduledSessionDTO[];
  conflicts: ConflictDTO[];
  rooms: RoomDTO[];
  tracks: TrackDTO[];
  /** Format names for the dialog and the List view's duration column. */
  formats: SessionFormatDTO[];
  /** Contact id + display name for every speaker the dialog can attach. */
  speakers: SpeakerOption[];
  /** Accepted abstracts, with `alreadyPromoted` refreshed through the agenda cache. */
  accepted: AcceptedForSchedulingRow[];
  day?: string | null;
  /**
   * Unscheduled count over the *unfiltered* session list. `sessions` arrives
   * already narrowed by the agenda's search box, so the Day view's
   * board-cleared celebration reads this instead — typing a search that hides
   * the tray must never look like placing its last session.
   */
  unscheduledTotal?: number;
  /** Opens the session dialog; the toolbar and every view share one dialog instance. */
  onEdit?: (sessionId: string) => void;
};

export type { SpeakerOption };
export { AGENDA_VIEWS, agendaHref, conflictsForSession, createSessionDefaultDay, eventDayKeys, nameLookup, parseDay, parseView, scheduledOnDay, unscheduled } from "./store";
export type { AgendaView, NameLookup } from "./store";
export { AgendaPage } from "./components/agenda-page";
