"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { suppressionRowSchema, type SuppressionRow } from "../schemas";
import type { ContactId, EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { QUERY_DEFAULTS } from "@/shared/lib/query-keys";
import { commsKeys } from "./keys";

const suppressionsResponseSchema = z.array(suppressionRowSchema);
const okResponseSchema = z.object({ ok: z.boolean() });

export function useSuppressions(eventId: EventId) {
  return useQuery({
    queryKey: commsKeys.suppressions(eventId),
    queryFn: () => api(`comms/${eventId}/suppressions`, suppressionsResponseSchema),
    ...QUERY_DEFAULTS,
  });
}

/** M46 — reinstate. Optimistically drops the row from the cached list; a
 * failed request restores it via `onError`'s snapshot rather than trusting
 * the optimistic state to have been right. */
export function useRemoveSuppression(eventId: EventId) {
  const queryClient = useQueryClient();
  const key = commsKeys.suppressions(eventId);
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
