import type { TxDb } from "@/db/client";
import type { EventId } from "@/shared/contracts";
import { eventDayKey, zonedInputToUtc } from "@/shared/lib/time";
import { seedId } from "./ids";

/**
 * What every per-feature seed module receives. One transaction for the whole
 * command-line run, one clock, and one id function — so a module can never
 * invent a non-deterministic id or read a different "now" than its neighbours.
 */
export type SeedCtx = {
  tx: TxDb;
  now: Date;
  eventId: EventId;
  /** The standing empty-state event. It must stay genuinely empty. */
  emptyEventId: EventId;
  id: (kind: string, key: string) => string;
  log: (msg: string) => void;
};

export type SeedModule = (ctx: SeedCtx) => Promise<void>;

/** The demo world's timezone; agents and judges are usually somewhere else. */
export const EVENT_TIMEZONE = "America/Los_Angeles";

export const SEED_KEYS = { event: "aie-nyc", emptyEvent: "empty-conf" } as const;

export const SEEDED_EVENT_ID = seedId("event", SEED_KEYS.event) as EventId;
export const SEEDED_EMPTY_EVENT_ID = seedId("event", SEED_KEYS.emptyEvent) as EventId;

/**
 * Authors a seeded instant as a local wall-clock time in the event's zone, the
 * way an organizer would type it. Never write bare UTC literals: the day tabs
 * bin against the event zone, so a bare literal lands a session on the wrong day
 * for everyone outside that zone.
 */
export function eventLocal(now: Date, offsetDays: number, localTime: string): Date {
  const day = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return zonedInputToUtc(`${eventDayKey(day, EVENT_TIMEZONE)}T${localTime}`, EVENT_TIMEZONE);
}
