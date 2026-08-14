"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { domainDeliverabilityRowSchema } from "../schemas";
import type { EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { QUERY_DEFAULTS } from "@/shared/lib/query-keys";
import { commsKeys } from "./keys";

const deliverabilityResponseSchema = z.array(domainDeliverabilityRowSchema);

export function useDeliverability(eventId: EventId) {
  return useQuery({
    queryKey: commsKeys.deliverability(eventId),
    queryFn: () => api(`comms/${eventId}/deliverability`, deliverabilityResponseSchema),
    ...QUERY_DEFAULTS,
    staleTime: 30_000,
  });
}
