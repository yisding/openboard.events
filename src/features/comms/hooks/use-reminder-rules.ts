"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { reminderRuleRowSchema } from "../schemas";
import type { EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { QUERY_DEFAULTS } from "@/shared/lib/query-keys";
import { commsKeys } from "./keys";

const rulesResponseSchema = z.array(reminderRuleRowSchema);

export function useReminderRules(eventId: EventId) {
  return useQuery({
    queryKey: commsKeys.reminderRules(eventId),
    queryFn: () => api(`comms/${eventId}/reminder-rules`, rulesResponseSchema),
    ...QUERY_DEFAULTS,
  });
}

export function useSaveReminderRules(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rules: { offsetDays: number; enabled: boolean }[]) =>
      api(`comms/${eventId}/reminder-rules`, rulesResponseSchema, { method: "PUT", body: { rules } }),
    onSuccess: (saved) => {
      queryClient.setQueryData(commsKeys.reminderRules(eventId), saved);
    },
  });
}
