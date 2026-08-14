"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  acceptedForSchedulingRowSchema,
  type EventId,
} from "@/shared/contracts";
import { api } from "@/shared/lib/api-client";
import { QUERY_DEFAULTS } from "@/shared/lib/query-keys";
import { announceBundleSchema } from "../schemas";
import { agendaKeys } from "./keys";

const acceptedSchema = z.array(acceptedForSchedulingRowSchema);

export function useAcceptedForAgenda(eventId: EventId) {
  return useQuery({
    queryKey: agendaKeys.accepted(eventId),
    queryFn: () => api(`agenda/accepted?eventId=${eventId}`, acceptedSchema),
    ...QUERY_DEFAULTS,
  });
}

export function useAnnounceBundle(eventId: EventId) {
  return useQuery({
    queryKey: agendaKeys.announceBundle(eventId),
    queryFn: () => api(`agenda/announce-bundle?eventId=${eventId}`, announceBundleSchema.nullable()),
    ...QUERY_DEFAULTS,
  });
}
