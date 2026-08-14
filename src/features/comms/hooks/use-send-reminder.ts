"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { openAssignmentRowSchema } from "../schemas";
import type { ContactId, EventId, SendReminderNowInput } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { qk } from "@/shared/lib/query-keys";

const assignmentsResponseSchema = z.array(openAssignmentRowSchema);
const sendReminderResponseSchema = z.object({ enqueued: z.boolean() });

export function useOpenAssignments(eventId: EventId, contactId: ContactId | null) {
  return useQuery({
    queryKey: qk("comms", eventId, "open-assignments", contactId ?? "-"),
    queryFn: () => api(`comms/${eventId}/open-assignments?contactId=${contactId}`, assignmentsResponseSchema),
    enabled: contactId !== null,
  });
}

export function useSendReminderNow(eventId: EventId) {
  return useMutation({
    mutationFn: (input: SendReminderNowInput) =>
      api(`comms/${eventId}/send-reminder`, sendReminderResponseSchema, { method: "POST", body: input }),
  });
}
