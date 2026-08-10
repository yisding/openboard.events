"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { reminderRuleRowSchema, type ReminderRuleRow } from "../schemas";
import type { EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { qk } from "@/shared/lib/query-keys";

const rulesResponseSchema = z.array(reminderRuleRowSchema);

export function useReminderRules(eventId: EventId, initialData: ReminderRuleRow[]) {
  return useQuery({
    queryKey: qk("comms", eventId, "reminder-rules"),
    queryFn: () => api(`comms/${eventId}/reminder-rules`, rulesResponseSchema),
    initialData,
    staleTime: 15_000,
  });
}

export function useSaveReminderRules(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rules: { offsetDays: number; enabled: boolean }[]) =>
      api(`comms/${eventId}/reminder-rules`, rulesResponseSchema, { method: "PUT", body: { rules } }),
    onSuccess: (saved) => {
      queryClient.setQueryData(qk("comms", eventId, "reminder-rules"), saved);
    },
  });
}
