"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { emailTemplateRowSchema, type EmailTemplateRow, type TemplateSaveInput } from "../schemas";
import type { EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { QUERY_DEFAULTS } from "@/shared/lib/query-keys";
import { commsKeys } from "./keys";

const templatesResponseSchema = z.array(emailTemplateRowSchema);

export function useTemplates(eventId: EventId) {
  return useQuery({
    queryKey: commsKeys.templates(eventId),
    queryFn: () => api(`comms/${eventId}/templates`, templatesResponseSchema),
    ...QUERY_DEFAULTS,
  });
}

export function useSaveTemplate(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateSaveInput) => api(`comms/${eventId}/templates`, emailTemplateRowSchema, { method: "PATCH", body: input }),
    onSuccess: (saved) => {
      queryClient.setQueryData<EmailTemplateRow[]>(commsKeys.templates(eventId), (current) =>
        current?.map((row) => row.key === saved.key ? saved : row) ?? current);
    },
  });
}
