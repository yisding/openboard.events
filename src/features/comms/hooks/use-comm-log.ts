"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { commLogDetailWithFlagSchema } from "../schemas";
import type { CommLogFilters } from "../server/queries";
import { commLogRowSchema, type CommLogId, type EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { qk } from "@/shared/lib/query-keys";

const logResponseSchema = z.array(commLogRowSchema);

export function useCommLog(eventId: EventId, filters: CommLogFilters, initialData?: z.infer<typeof logResponseSchema>) {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.templateKey) query.set("templateKey", filters.templateKey);
  if (filters.contactId) query.set("contactId", filters.contactId);
  if (filters.limit) query.set("limit", String(filters.limit));
  const search = query.toString();
  return useQuery({
    queryKey: qk("comms", eventId, "log", filters),
    queryFn: () => api(`comms/${eventId}/log${search ? `?${search}` : ""}`, logResponseSchema),
    ...(initialData ? { initialData } : {}),
    staleTime: 15_000,
  });
}

export function useCommLogDetail(eventId: EventId, logId: CommLogId | null) {
  return useQuery({
    queryKey: qk("comms", eventId, "log-detail", logId ?? "-"),
    queryFn: () => api(`comms/${eventId}/log/${logId}`, commLogDetailWithFlagSchema),
    enabled: logId !== null,
  });
}
