"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { commLogDetailWithFlagSchema, retryFailedCommunicationsResultSchema } from "../schemas";
import type { CommLogFilters } from "../server/queries";
import { commLogRowSchema, type CommLogId, type EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { QUERY_DEFAULTS } from "@/shared/lib/query-keys";
import { commsKeys } from "./keys";

const logResponseSchema = z.array(commLogRowSchema);

export function useCommLog(eventId: EventId, filters: CommLogFilters) {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.templateKey) query.set("templateKey", filters.templateKey);
  if (filters.contactId) query.set("contactId", filters.contactId);
  if (filters.limit) query.set("limit", String(filters.limit));
  const search = query.toString();
  return useQuery({
    queryKey: commsKeys.log(eventId, filters),
    queryFn: () => api(`comms/${eventId}/log${search ? `?${search}` : ""}`, logResponseSchema),
    ...QUERY_DEFAULTS,
  });
}

export function useCommLogDetail(eventId: EventId, logId: CommLogId | null) {
  return useQuery({
    queryKey: commsKeys.logDetail(eventId, logId),
    queryFn: () => api(`comms/${eventId}/log/${logId}`, commLogDetailWithFlagSchema),
    enabled: logId !== null,
  });
}

export function useRetryFailedCommunications(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (logIds: CommLogId[]) => api(
      `comms/${eventId}/log/retry`,
      retryFailedCommunicationsResultSchema,
      { method: "POST", body: { logIds } },
    ),
    // A failed HTTP response can still be ambiguous after the server commits.
    // Always reload once; repeating the action remains safe because the same
    // row is now `queued` and keeps its original idempotency key.
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: commsKeys.logs(eventId) }); },
  });
}
