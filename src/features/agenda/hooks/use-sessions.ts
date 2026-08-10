"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { scheduledSessionDtoSchema, type EventId, type ScheduledSessionDTO } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { QUERY_DEFAULTS } from "@/shared/lib/query-keys";
import { agendaKeys } from "./keys";

const sessionsSchema = z.array(scheduledSessionDtoSchema);

/**
 * The client's copy of the server-rendered list.
 *
 * `initialData` is the server component's own read, so the first paint has no
 * request behind it; the query exists so a save or a promote can invalidate one
 * key instead of forcing a full route refresh.
 */
export function useSessions(eventId: EventId, initialData: ScheduledSessionDTO[]) {
  return useQuery({
    queryKey: agendaKeys.sessions(eventId),
    queryFn: () => api(`agenda/sessions?eventId=${eventId}`, sessionsSchema),
    initialData,
    ...QUERY_DEFAULTS,
  });
}
