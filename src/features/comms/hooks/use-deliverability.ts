"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { domainDeliverabilityRowSchema, type DomainDeliverabilityRow } from "../schemas";
import type { EventId } from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { qk } from "@/shared/lib/query-keys";

const deliverabilityResponseSchema = z.array(domainDeliverabilityRowSchema);

export function useDeliverability(eventId: EventId, initialData: DomainDeliverabilityRow[]) {
  return useQuery({
    queryKey: qk("comms", eventId, "deliverability"),
    queryFn: () => api(`comms/${eventId}/deliverability`, deliverabilityResponseSchema),
    initialData,
    staleTime: 30_000,
  });
}
