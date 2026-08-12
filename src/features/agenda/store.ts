import type { ConflictDTO, EventId, RoomDTO, ScheduledSessionDTO, SessionId, TrackDTO } from "@/shared/contracts";
import { eventDayKey, hourMinuteInZone, zonedInputToUtc } from "@/shared/lib/time";
import type { AgendaVocabulary, SpeakerOption } from "./server/queries";

/**
 * The agenda's shared, framework-free derivations.
 *
 * Everything here is a pure function of the props a view already has. It lives
 * outside the components because five views ask the same four questions —
 * which day is this session on, what is this room called, who speaks in it, and
 * is it in conflict — and five answers would drift apart within a day.
 */

export const AGENDA_VIEWS = ["list", "day", "week", "track", "room", "conflicts"] as const;
export type AgendaView = (typeof AGENDA_VIEWS)[number];

export function parseView(value: string | string[] | undefined): AgendaView {
  const candidate = Array.isArray(value) ? value[0] : value;
  return AGENDA_VIEWS.includes(candidate as AgendaView) ? candidate as AgendaView : "list";
}

/** `YYYY-MM-DD` or nothing; a malformed tab in the URL must not reach a query. */
export function parseDay(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

/**
 * Every day key the event spans, in the event's zone.
 *
 * Stepping by 24h from the start instant and re-deriving the key each time is
 * what keeps a DST transition from dropping or duplicating a tab: the arithmetic
 * is on instants, the labels come from `eventDayKey`.
 */
export function eventDayKeys(startsAt: string, endsAt: string, timezone: string): string[] {
  const keys: string[] = [];
  const last = eventDayKey(endsAt, timezone);
  let cursor = new Date(startsAt).getTime();
  const limit = new Date(endsAt).getTime() + 2 * 24 * 60 * 60 * 1000;
  for (let guard = 0; guard < 64 && cursor <= limit; guard += 1) {
    const key = eventDayKey(cursor, timezone);
    if (!keys.includes(key)) keys.push(key);
    if (key === last) break;
    cursor += 24 * 60 * 60 * 1000;
  }
  return keys;
}

/**
 * A valid initial placement for the session dialog's "scheduled" toggle.
 *
 * The selected agenda day is a calendar date in the event timezone, not in the
 * browser's timezone. Start at the event's local opening clock on that day,
 * then clamp both the start and the preferred duration to the event's absolute
 * bounds. The clamp also covers short events and a partial final day.
 */
export function defaultScheduledRange(
  event: { startsAt: string; endsAt: string; timezone: string },
  selectedDay: string | null,
  preferredDurationMs: number,
): { startsAt: string; endsAt: string } {
  const eventStartMs = Date.parse(event.startsAt);
  const eventEndMs = Date.parse(event.endsAt);
  const availableMs = eventEndMs - eventStartMs;
  const requestedDurationMs = Number.isFinite(preferredDurationMs) && preferredDurationMs > 0
    ? preferredDurationMs
    : 30 * 60_000;
  const durationMs = Math.min(requestedDurationMs, availableMs);
  const validDays = eventDayKeys(event.startsAt, event.endsAt, event.timezone);

  let candidateStartMs = eventStartMs;
  if (selectedDay && validDays.includes(selectedDay)) {
    const { hour, minute } = hourMinuteInZone(event.startsAt, event.timezone);
    const localStart = `${selectedDay}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
    candidateStartMs = zonedInputToUtc(localStart, event.timezone).getTime();
  }

  const latestStartMs = eventEndMs - durationMs;
  const startsAtMs = Math.min(Math.max(candidateStartMs, eventStartMs), latestStartMs);
  return {
    startsAt: new Date(startsAtMs).toISOString(),
    endsAt: new Date(startsAtMs + durationMs).toISOString(),
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/**
 * The three parts of a day tab's label, from the key alone.
 *
 * The key is already an event-zone calendar date, so reading it back at UTC noon
 * with `getUTCDay` is exact arithmetic on that date — there is no second zone
 * conversion to get wrong, and nothing here depends on the viewer's locale.
 */
export function dayTabLabel(dayKey: string): { weekday: string; day: string; month: string } {
  const [year = 1970, month = 1, day = 1] = dayKey.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day, 12));
  return {
    weekday: WEEKDAYS[at.getUTCDay()] ?? "",
    day: String(day),
    month: MONTHS[month - 1] ?? "",
  };
}

/** Unscheduled sessions are the tray's whole content, and never a grid's. */
export function unscheduled(sessions: readonly ScheduledSessionDTO[]): ScheduledSessionDTO[] {
  return sessions.filter((session) => session.startsAt === null);
}

export function scheduledOnDay(
  sessions: readonly ScheduledSessionDTO[],
  day: string | null,
  timezone: string,
): ScheduledSessionDTO[] {
  return sessions.filter((session) =>
    session.startsAt !== null && (day === null || eventDayKey(session.startsAt, timezone) === day));
}

export type NameLookup = {
  room: (id: string | null) => string | null;
  track: (id: string | null) => TrackDTO | null;
  format: (id: string | null) => string | null;
  speakers: (ids: readonly string[]) => string[];
};

/**
 * Ids in, display names out — with `null` for "deleted or never set", never a
 * thrown error. Rooms, tracks and formats all `ON DELETE SET NULL` onto
 * sessions, so a missing lookup is an ordinary Tuesday, not a bug.
 */
export function nameLookup(vocabulary: {
  rooms: readonly RoomDTO[];
  tracks: readonly TrackDTO[];
  formats?: AgendaVocabulary["formats"];
  speakers?: readonly SpeakerOption[];
}): NameLookup {
  const rooms = new Map(vocabulary.rooms.map((room) => [String(room.id), room.name]));
  const tracks = new Map(vocabulary.tracks.map((track) => [String(track.id), track]));
  const formats = new Map((vocabulary.formats ?? []).map((format) => [String(format.id), format.name]));
  const speakers = new Map((vocabulary.speakers ?? []).map((speaker) => [String(speaker.contactId), speaker.name]));
  return {
    room: (id) => (id === null ? null : rooms.get(id) ?? null),
    track: (id) => (id === null ? null : tracks.get(id) ?? null),
    format: (id) => (id === null ? null : formats.get(id) ?? null),
    speakers: (ids) => ids.flatMap((id) => {
      const name = speakers.get(String(id));
      return name ? [name] : [];
    }),
  };
}

/** The conflict ids touching one session, for the row's warning chip. */
export function conflictsForSession(
  conflicts: readonly ConflictDTO[],
  sessionId: SessionId,
): ConflictDTO[] {
  return conflicts.filter((conflict) => conflict.a === sessionId || conflict.b === sessionId);
}

/** Keep conflict relationships whose left or right session is in a visible search result. */
export function conflictsTouchingSessions(
  conflicts: readonly ConflictDTO[],
  sessions: readonly ScheduledSessionDTO[],
): ConflictDTO[] {
  const visibleIds = new Set(sessions.map((session) => String(session.id)));
  return conflicts.filter((conflict) => visibleIds.has(String(conflict.a)) || visibleIds.has(String(conflict.b)));
}

export function agendaHref(eventId: EventId, view: AgendaView, day?: string | null): string {
  const query = new URLSearchParams({ view });
  if (day) query.set("day", day);
  return `/events/${eventId}/agenda?${query.toString()}`;
}
