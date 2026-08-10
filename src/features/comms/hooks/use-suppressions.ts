"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { suppressionRowSchema, type SuppressionRow } from "../schemas";
import type { ContactId, EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { qk } from "@/shared/lib/query-keys";

const suppressionsResponseSchema = z.array(suppressionRowSchema);
const okResponseSchema = z.object({ ok: z.boolean() });

export function useSuppressions(eventId: EventId, initialData: SuppressionRow[]) {
  return useQuery({
    queryKey: qk("comms", eventId, "suppressions"),
    queryFn: () => api(`comms/${eventId}/suppressions`, suppressionsResponseSchema),
    initialData,
    staleTime: 15_000,
  });
}

/** M46 — reinstate. Optimistically drops the row from the cached list; a
 * failed request restores it via `onError`'s snapshot rather than trusting
 * the optimistic state to have been right. */
export function useRemoveSuppression(eventId: EventId) {
  const queryClient = useQueryClient();
  const key = qk("comms", eventId, "suppressions");
  return useMutation({
    mutationFn: (contactId: ContactId) =>
      api(`comms/${eventId}/suppressions/${contactId}`, okResponseSchema, { method: "DELETE" }),
    onMutate: async (contactId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SuppressionRow[]>(key);
      queryClient.setQueryData<SuppressionRow[]>(key, (current) => current?.filter((row) => row.contactId !== contactId));
      return { previous };
    },
    onError: (_error, _contactId, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: key }); },
  });
}
