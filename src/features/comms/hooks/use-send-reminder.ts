"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { openAssignmentRowSchema } from "../schemas";
import { sendReminderNowResultSchema, type ContactId, type EventId, type SendReminderNowInput } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { commsKeys } from "./keys";

const assignmentsResponseSchema = z.array(openAssignmentRowSchema);
export function useOpenAssignments(eventId: EventId, contactId: ContactId | null) {
  return useQuery({
    queryKey: commsKeys.openAssignments(eventId, contactId),
    queryFn: () => api(`comms/${eventId}/open-assignments?contactId=${contactId}`, assignmentsResponseSchema),
    enabled: contactId !== null,
  });
}

export function useSendReminderNow(eventId: EventId) {
  return useMutation({
    mutationFn: (input: SendReminderNowInput) =>
      api(`comms/${eventId}/send-reminder`, sendReminderNowResultSchema, { method: "POST", body: input }),
  });
}
