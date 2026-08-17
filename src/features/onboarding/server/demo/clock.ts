import { eventDayKey, zonedInputToUtc } from "@/shared/lib/time";

/**
 * The demo world's frozen clock (design §2.5, D4).
 *
 * Every instant in the demo — the event window, the two CFP forms' open/close
 * dates, the one deliberately-overdue portal task, the backdated
 * `communication_logs` rows — is authored as an *offset* from a single
 * `now`, never as a literal date. Ten provisioning phases each run in their
 * own HTTP request, so `now` is captured once (`cursor.createdAt`, see
 * `provisioning.ts`) and threaded through every phase; if each phase read its
 * own `new Date()` instead, a provision that straddled local midnight or was
 * resumed after a failure could land phase 7's sessions on a different
 * wall-clock day than phase 1's event window — which would also un-plant the
 * two planted conflicts, since they depend on two sessions landing on
 * *exactly* the same day and minute.
 *
 * `demoLocal` mirrors `scripts/seed/lib/helpers.ts`'s `eventLocal` (same
 * "author as local wall-clock, not bare UTC" discipline, so a session at
 * 9am Pacific lands on the correct day tab for every viewer regardless of
 * their own timezone) but is deliberately not shared code: the seed's
 * `eventLocal` is pinned to the *sandbox's* fixed `now` semantics, and this
 * module owns the *demo's* — importing between them would make an edit to
 * one module's date math a silent behavior change in the other's.
 *
 * Every date-arithmetic call in this file goes through `@/shared/lib/time`,
 * the repo's one sanctioned date-fns door (`scripts/check-source-invariants.ts`).
 */

export const DEMO_TIMEZONE = "America/Los_Angeles";

/**
 * Author an instant as a local wall-clock time in the demo's timezone, the
 * way an organizer would type it into a date picker. `offsetDays` may be
 * negative (the CFP opened three weeks ago) or positive (the event itself is
 * always in the future). Never write a bare UTC literal here: the agenda's
 * day tabs bin sessions by the event-local calendar date, so a literal lands
 * a session on the wrong day for anyone outside `DEMO_TIMEZONE`.
 */
export function demoLocal(now: Date, offsetDays: number, localTime: string): Date {
  const [year, month, day] = eventDayKey(now, DEMO_TIMEZONE).split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + offsetDays));
  return zonedInputToUtc(`${shifted.toISOString().slice(0, 10)}T${localTime}`, DEMO_TIMEZONE);
}

/**
 * How far after `now` the event window opens. Kept as a named constant because
 * `demoNowFromEventStart` has to invert exactly this offset.
 */
const EVENT_START_OFFSET_DAYS = 65;

/**
 * Recovers the frozen clock from an event window that is already committed —
 * the inverse of `demoDates(now).event.startsAt`.
 *
 * Phase 1 writes the event row and the cursor that holds the frozen clock in
 * two separate statements against an autocommitting handle, so a request that
 * dies between them leaves an event whose dates were authored at T1 and no
 * cursor at all. The retry arrives at T2, `createEventIn` recognizes its own
 * id and returns the existing row **without re-authoring `starts_at`**, and a
 * cursor stamped T2 would then have every later phase build a world days out
 * of step with the window phase 7's sessions must fit inside — a wedge that no
 * amount of retrying can clear, because both sides of the comparison are
 * immutable.
 *
 * So the frozen clock is a property of the committed event row, not of
 * whichever request happened to win. `demoLocal` bins on the event-local
 * calendar day, so inverting the offset only has to recover that day; noon
 * local is chosen as the materialized instant because it is the furthest any
 * wall-clock time can be from a DST transition or a date boundary.
 */
export function demoNowFromEventStart(startsAt: Date): Date {
  const [year, month, day] = eventDayKey(startsAt, DEMO_TIMEZONE).split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - EVENT_START_OFFSET_DAYS));
  return zonedInputToUtc(`${shifted.toISOString().slice(0, 10)}T12:00`, DEMO_TIMEZONE);
}

export type DemoDates = {
  now: Date;
  event: {
    /** +65 d, 09:00 local. Far enough out that the CFP is plausibly still
     *  open; close enough that "N days to go" on the dashboard is a real,
     *  motivating number. */
    startsAt: Date;
    /** +67 d, 17:00 local — a 3-day conference. */
    endsAt: Date;
    /** The year is computed from `startsAt`, never hard-coded, so the name
     *  reads correctly in 2026 and in every year after it (design §2.5): no
     *  annual maintenance ticket, ever. */
    name: string;
    timezone: typeof DEMO_TIMEZONE;
  };
  forms: {
    /** Form A — "Speak at AI Engineer World's Fair". Open now, closes well
     *  after the event window's own +65 d, so "the CFP is always open" holds
     *  for every sampled `now`. */
    cfp: { opensAt: Date; closesAt: Date };
    /** Form B — "Expo Stage Lightning Talks". Closed five days ago, so the
     *  branded closed page always has something genuinely past its date to
     *  render, not one an organizer merely switched off. */
    expoLightning: { opensAt: Date; closesAt: Date };
  };
  submissions: {
    /** The oldest and newest `submitted_at`/`created_at` among the 24
     *  proposals — always in the past, always before `now`. */
    earliestSubmittedAt: Date;
    latestSubmittedAt: Date;
  };
  portal: {
    /** Victor Achebe's travel form: due 30 days ago, so the entire reminder
     *  ladder has already fired by the time the organizer meets it (§2.4).
     *  Created before it was due, so the row is temporally coherent. */
    overdueTaskDueAt: Date;
    overdueTaskCreatedAt: Date;
  };
  comms: {
    /** The 9 backdated `communication_logs` rows span this window. */
    earliestLogAt: Date;
    latestLogAt: Date;
  };
};

/**
 * The whole temporal vector, derived from one `now`. A pure function: the
 * same `now` always produces the same `DemoDates`, which is what makes a
 * resumed, multi-request provision (D4) land every phase on a coherent
 * world instead of a schedule that quietly drifts between requests.
 */
export function demoDates(now: Date): DemoDates {
  const startsAt = demoLocal(now, EVENT_START_OFFSET_DAYS, "09:00");
  const endsAt = demoLocal(now, 67, "17:00");
  const year = eventDayKey(startsAt, DEMO_TIMEZONE).slice(0, 4);

  return {
    now,
    event: {
      startsAt,
      endsAt,
      name: `AI Engineer World’s Fair ${year}`,
      timezone: DEMO_TIMEZONE,
    },
    forms: {
      cfp: { opensAt: demoLocal(now, -20, "00:00"), closesAt: demoLocal(now, 12, "23:59") },
      expoLightning: { opensAt: demoLocal(now, -40, "00:00"), closesAt: demoLocal(now, -5, "23:59") },
    },
    submissions: {
      earliestSubmittedAt: demoLocal(now, -35, "10:00"),
      latestSubmittedAt: demoLocal(now, -2, "16:00"),
    },
    portal: {
      overdueTaskDueAt: demoLocal(now, -30, "17:00"),
      overdueTaskCreatedAt: demoLocal(now, -45, "09:00"),
    },
    comms: {
      earliestLogAt: demoLocal(now, -14, "09:00"),
      // "−1 h" is relative to the instant `now`, not the local calendar day —
      // `demoLocal(now, 0, …)` would land on *today's* wall-clock time in
      // `DEMO_TIMEZONE`, which is in the future whenever `now`'s local time is
      // earlier than that. Plain instant arithmetic is correct here.
      latestLogAt: new Date(now.getTime() - 60 * 60 * 1000),
    },
  };
}
