"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { scheduledSessionDtoSchema, type EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { QUERY_DEFAULTS } from "@/shared/lib/query-keys";
import { agendaKeys } from "./keys";

const sessionsSchema = z.array(scheduledSessionDtoSchema);

/**
 * The live owner of the server-seeded list.
 *
 * `QueryBoundary` seeds this exact key for the first paint; saves, moves, and
 * promotions invalidate or patch it without forcing a full route refresh.
 */
export function useSessions(eventId: EventId) {
  return useQuery({
    queryKey: agendaKeys.sessions(eventId),
    queryFn: () => api(`agenda/sessions?eventId=${eventId}`, sessionsSchema),
    ...QUERY_DEFAULTS,
  });
}
