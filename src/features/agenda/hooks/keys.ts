import type { EventId } from "@/shared/contracts";
import { qk } from "@/shared/lib/query-keys";

/**
 * One key per read, built here so a mutation's invalidation and a query's
 * subscription can never spell the same cache slot differently.
 */
export const agendaKeys = {
  sessions: (eventId: EventId, filters?: Record<string, unknown>) =>
    filters ? qk("agenda", eventId, "sessions", filters) : qk("agenda", eventId, "sessions"),
  /** The prefix every session read shares; what a write invalidates. */
  allSessions: (eventId: EventId) => qk("agenda", eventId, "sessions"),
} as const;
