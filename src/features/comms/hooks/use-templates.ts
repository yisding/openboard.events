"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { emailTemplateRowSchema, type EmailTemplateRow, type TemplateSaveInput } from "../schemas";
import type { EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { qk } from "@/shared/lib/query-keys";

const templatesResponseSchema = z.array(emailTemplateRowSchema);

export function useTemplates(eventId: EventId, initialData: EmailTemplateRow[]) {
  return useQuery({
    queryKey: qk("comms", eventId, "templates"),
    queryFn: () => api(`comms/${eventId}/templates`, templatesResponseSchema),
    initialData,
    staleTime: 15_000,
  });
}

export function useSaveTemplate(eventId: EventId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateSaveInput) => api(`comms/${eventId}/templates`, emailTemplateRowSchema, { method: "PATCH", body: input }),
    onSuccess: (saved) => {
      queryClient.setQueryData<EmailTemplateRow[]>(qk("comms", eventId, "templates"), (current) =>
        current?.map((row) => row.key === saved.key ? saved : row) ?? current);
    },
  });
}
